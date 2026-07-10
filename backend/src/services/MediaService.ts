import { MediaKind, MediaStatus, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { checkProjectAccess } from '../middleware/rbac';
import { storage, StorageService } from './StorageService';
import { validateMediaHeader, getExtension, detectImage } from '../lib/fileSignatures';
import { resolveProjectIdForVersion, resolveStorageContextForVersion } from '../lib/pipeline';
import { slugifyFilename } from '../lib/slug';
import { softDeleteMedia, restoreMedia, purgeMedia } from '../lib/trash';
import { logAudit } from './AuditService';
import { emitToProject } from './SocketService';
import { enqueueMediaJob } from './JobService';
import { getNumericSetting, SETTING_KEYS } from '../lib/settings';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors';
import { type PaginationParams, type Paginated, pageArgs, paginate } from '../lib/pagination';

/**
 * Logique métier des médias (upload présigné, finalize/validation magic bytes,
 * publication, reprocess, bibliothèque, corbeille). Les routes ne font que
 * valider → appeler ces fonctions → répondre (cf. 10.D8).
 */

type SessionUser = { id: number; role: Role };

// Formats 3D convertibles en GLB (model-viewer ne lit que GLB/glTF) — 9.A1.
const CONVERT_3D = ['.fbx', '.obj', '.usd', '.usda', '.usdc', '.dae', '.stl', '.gltf', '.zip', '.usdz'];

/** Sérialise le `size` BigInt d'un média en Number pour la réponse JSON. */
const serializeMedia = <T extends { size: bigint }>(m: T): Omit<T, 'size'> & { size: number } => ({
  ...m,
  size: Number(m.size),
});

/** Job de traitement à déclencher selon le type de média et l'extension détectée. */
function jobKindFor(kind: MediaKind, ext: string): 'transcode' | 'thumbnail' | 'convert3d' | null {
  if (kind === MediaKind.VIDEO) return 'transcode';
  if (kind === MediaKind.IMAGE) return 'thumbnail';
  if (kind === MediaKind.MODEL_3D && CONVERT_3D.includes(ext)) return 'convert3d';
  return null;
}

export interface CreateUploadInput {
  versionId: number;
  filename: string;
  contentType: string;
  kind: MediaKind;
  size?: number;
}

/** Crée un MediaObject (UPLOADING) et renvoie une URL présignée PUT. */
export async function createUpload(user: SessionUser, input: CreateUploadInput) {
  const { versionId, filename, contentType, kind, size } = input;
  const storageCtx = await resolveStorageContextForVersion(versionId);
  if (!storageCtx) throw notFound('Version introuvable ou non rattachée à un projet');
  const projectId = storageCtx.projectId;
  if (!(await checkProjectAccess(user.id, user.role, projectId))) throw forbidden('Accès au projet refusé');

  // Quotas configurables (admin exempté du quota de stockage).
  const maxFileSize = await getNumericSetting(SETTING_KEYS.MAX_FILE_SIZE);
  if (size && size > maxFileSize) throw badRequest('Fichier trop volumineux', 'FILE_TOO_LARGE');

  const maxConcurrent = await getNumericSetting(SETTING_KEYS.MAX_CONCURRENT_UPLOADS);
  const active = await prisma.mediaObject.count({
    where: { uploaderId: user.id, status: MediaStatus.UPLOADING },
  });
  if (active >= maxConcurrent) throw new AppError("Trop d'uploads simultanés", 429, 'TOO_MANY_UPLOADS');

  if (user.role !== Role.ADMIN) {
    const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { storageLimit: true } });
    const limit =
      dbUser?.storageLimit != null
        ? Number(dbUser.storageLimit)
        : await getNumericSetting(SETTING_KEYS.STORAGE_LIMIT_USER);
    const agg = await prisma.mediaObject.aggregate({ _sum: { size: true }, where: { uploaderId: user.id } });
    const used = Number(agg._sum.size ?? 0n);
    if (used + (size ?? 0) > limit) throw forbidden('Quota de stockage dépassé', 'STORAGE_LIMIT');
  }

  const media = await prisma.mediaObject.create({
    data: {
      versionId,
      kind,
      originalName: filename,
      storageKey: '', // rempli juste après avec l'id
      mimeType: contentType,
      status: MediaStatus.UPLOADING,
      uploaderId: user.id,
    },
  });
  const storageKey = StorageService.mediaKey({
    projectSlug: storageCtx.projectSlug,
    parentSegment: storageCtx.parentSegment,
    versionName: storageCtx.versionName,
    mediaId: media.id,
    filename: slugifyFilename(filename),
  });
  await prisma.mediaObject.update({ where: { id: media.id }, data: { storageKey } });

  const uploadUrl = await storage.getPresignedPutUrl(storageKey, contentType);
  return { mediaObjectId: media.id, storageKey, uploadUrl };
}

/** Finalise un upload : valide les magic bytes, met la taille à jour, déclenche le traitement. */
export async function finalize(user: SessionUser, id: number) {
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Média introuvable');

  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('Accès au projet refusé');

  const stat = await storage.statObject(media.storageKey);
  const header = await storage.getObjectHeader(media.storageKey, 32);
  const hintExt = getExtension(media.originalName);
  const detected = validateMediaHeader(media.kind, header, hintExt, stat.size);

  if (!detected) {
    await prisma.mediaObject.update({ where: { id }, data: { status: MediaStatus.FAILED } });
    await storage.deleteObject(media.storageKey).catch(() => undefined);
    throw badRequest('Type de fichier invalide (validation magic bytes échouée)', 'INVALID_FILE');
  }

  const jobKind = jobKindFor(media.kind, detected);
  const updated = await prisma.mediaObject.update({
    where: { id },
    data: { status: jobKind ? MediaStatus.PROCESSING : MediaStatus.READY, size: BigInt(stat.size) },
  });
  if (jobKind) await enqueueMediaJob({ mediaObjectId: id, kind: jobKind });

  // Compteur de stockage utilisateur (affichage ; le quota utilise la somme live).
  if (media.uploaderId) {
    await prisma.user.update({
      where: { id: media.uploaderId },
      data: { storageUsed: { increment: BigInt(stat.size) } },
    });
  }

  return { media: serializeMedia(updated), detectedExtension: detected };
}

/** Bibliothèque paginée : médias publiés (READY) d'un projet, avec URLs présignées. */
export async function listPublished(
  user: SessionUser,
  projectId: number,
  kind: MediaKind | undefined,
  p: PaginationParams,
): Promise<Paginated<unknown>> {
  if (!(await checkProjectAccess(user.id, user.role, projectId))) throw forbidden('Accès au projet refusé');
  const where = {
    published: true,
    deletedAt: null,
    status: MediaStatus.READY,
    ...(kind ? { kind } : {}),
    version: {
      OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
    },
  };
  const [media, total] = await Promise.all([
    prisma.mediaObject.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(p) }),
    prisma.mediaObject.count({ where }),
  ]);
  const items = await Promise.all(
    media.map(async (m) => ({
      id: m.id,
      kind: m.kind,
      originalName: m.originalName,
      thumbnailUrl: m.thumbnailKey ? await storage.getPresignedGetUrl(m.thumbnailKey) : null,
      url: await storage.getPresignedGetUrl(m.storageKey),
    })),
  );
  return paginate(items, total, p);
}

/** Brouillons (non publiés) de l'utilisateur, avec localisation lisible. */
export async function listDrafts(userId: number) {
  const drafts = await prisma.mediaObject.findMany({
    where: { published: false, deletedAt: null, uploaderId: userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      version: {
        select: {
          id: true,
          name: true,
          task: {
            select: {
              id: true,
              name: true,
              shot: { select: { code: true, sequence: { select: { code: true } } } },
              asset: { select: { name: true } },
            },
          },
          asset: { select: { name: true } },
        },
      },
    },
  });
  return drafts.map((m) => {
    const v = m.version;
    const t = v?.task;
    let location = '';
    if (t?.shot)
      location = `${t.shot.sequence ? t.shot.sequence.code + ' · ' : ''}${t.shot.code} › ${t.name}`;
    else if (t?.asset) location = `${t.asset.name} › ${t.name}`;
    else if (v?.asset) location = v.asset.name;
    return {
      id: m.id,
      originalName: m.originalName,
      kind: m.kind,
      status: m.status,
      versionName: v?.name ?? '',
      location,
      createdAt: m.createdAt,
    };
  });
}

/** Publie un média brouillon (réservé à l'uploader). */
export async function publish(user: SessionUser, id: number) {
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Média introuvable');
  // Brouillon strictement privé : seul l'uploader voit et publie son média (404 sinon).
  if (media.uploaderId !== user.id) throw notFound('Média introuvable');
  const updated = await prisma.mediaObject.update({ where: { id }, data: { published: true } });
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (projectId) emitToProject(projectId, 'media:update', { projectId, id, versionId: media.versionId });
  return serializeMedia(updated);
}

/** Relance le job de traitement d'un média (échec/bloqué). */
export async function reprocess(user: SessionUser, id: number) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Média introuvable');
  if (media.status === MediaStatus.UPLOADING) throw badRequest('Upload non finalisé', 'NOT_FINALIZED');

  const jobKind = jobKindFor(media.kind, getExtension(media.originalName));
  if (!jobKind) {
    // Rien à reconvertir (ex : GLB/glTF natif) → simplement remettre READY.
    const updated = await prisma.mediaObject.update({ where: { id }, data: { status: MediaStatus.READY } });
    return { media: serializeMedia(updated), requeued: false };
  }

  const updated = await prisma.mediaObject.update({
    where: { id },
    data: { status: MediaStatus.PROCESSING },
  });
  await enqueueMediaJob({ mediaObjectId: id, kind: jobKind });
  logAudit({ userId: user.id, action: 'MEDIA_REPROCESS', entityType: 'MediaObject', entityId: id });
  return { media: serializeMedia(updated), requeued: true };
}

/** Détail complet d'un média + URLs présignées (original, miniature, proxy, glb). */
export async function getDetail(user: SessionUser, id: number) {
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Média introuvable');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Média introuvable');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('Accès au projet refusé');
  const meta = (media.metadata ?? {}) as {
    proxyKey?: string;
    glbKey?: string;
    fps?: number;
    width?: number;
    height?: number;
    splatEdits?: unknown;
    splatMaskKey?: string;
    splatMaskCount?: number;
    splatPresentation?: unknown;
    editedAfterPublishAt?: string;
    editedAfterPublishById?: number;
    trim?: { inFrame: number; outFrame: number };
    trimProxyKey?: string;
  };
  // Proxy trimé (10.G-V10) : sert la coupe non-destructive à tous dès qu'elle est produite.
  const proxyKey = meta.trim && meta.trimProxyKey ? meta.trimProxyKey : meta.proxyKey;
  const [url, thumbnailUrl, proxyUrl, glbUrl, splatMaskUrl, project] = await Promise.all([
    storage.getPresignedGetUrl(media.storageKey),
    media.thumbnailKey ? storage.getPresignedGetUrl(media.thumbnailKey) : Promise.resolve(null),
    proxyKey ? storage.getPresignedGetUrl(proxyKey) : Promise.resolve(null),
    meta.glbKey ? storage.getPresignedGetUrl(meta.glbKey) : Promise.resolve(null),
    meta.splatMaskKey ? storage.getPresignedGetUrl(meta.splatMaskKey) : Promise.resolve(null),
    prisma.project.findUnique({ where: { id: projectId }, select: { startFrame: true } }),
  ]);
  return {
    media: serializeMedia(media),
    url,
    thumbnailUrl,
    proxyUrl,
    glbUrl,
    startFrame: project?.startFrame ?? 1001,
    fps: meta.fps ?? null,
    // Éditions splat non-destructives (10.G) : JSON + masque binaire (SplatEditService).
    splatEdits: meta.splatEdits ?? null,
    splatMaskUrl,
    splatMaskCount: meta.splatMaskCount ?? 0,
    // Présentation persistée (10.G-V5) : caméra/DoF/reveal/LOD/animation, rejouée pour tous.
    splatPresentation: meta.splatPresentation ?? null,
    // Marqueur « modifié après publication » (10.G-V10) → badge côté review.
    editedAfterPublishAt: meta.editedAfterPublishAt ?? null,
    editedAfterPublishById: meta.editedAfterPublishById ?? null,
    // Trim vidéo non-destructif (10.G-V10) : bornes + proxy trimé prêt ou en cours.
    trim: meta.trim ?? null,
    trimProxyReady: Boolean(meta.trim && meta.trimProxyKey),
  };
}

/** URL présignée GET pour le serving direct depuis MinIO. */
export async function getUrl(user: SessionUser, id: number) {
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Média introuvable');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Média introuvable');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('Accès au projet refusé');
  return storage.getPresignedGetUrl(media.storageKey);
}

const MAX_THUMBNAIL_BYTES = 1_500_000;

/**
 * Enregistre une miniature fournie par le client (capture d'un rendu, ex. splat/3D via
 * Three.js — pas de rendu headless serveur possible). Data URL image/jpeg|png|webp base64,
 * validée par magic bytes, stockée dans MinIO, référencée par `thumbnailKey`. Réservé aux
 * gestionnaires du média (uploader/superviseur+). Renvoie l'URL présignée de la miniature.
 */
export async function setThumbnail(user: SessionUser, id: number, dataUrl: string) {
  await assertMediaManage(id, user);
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(dataUrl);
  if (!m) throw badRequest('Miniature invalide (data URL image attendue)', 'INVALID_THUMBNAIL');
  const contentType = m[1]!.toLowerCase();
  const buf = Buffer.from(m[2]!, 'base64');
  if (buf.length === 0 || buf.length > MAX_THUMBNAIL_BYTES)
    throw badRequest('Miniature vide ou trop volumineuse', 'INVALID_THUMBNAIL');
  if (!detectImage(buf.subarray(0, 16)))
    throw badRequest('Contenu de miniature non reconnu comme image', 'INVALID_THUMBNAIL');

  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const key = StorageService.thumbnailKey(id, ext);
  await storage.putObject(key, buf, contentType);
  await prisma.mediaObject.update({ where: { id }, data: { thumbnailKey: key } });
  return { thumbnailUrl: await storage.getPresignedGetUrl(key) };
}

/** Vérifie que l'utilisateur peut gérer ce média (uploader ou superviseur+) et renvoie le projet. */
export async function assertMediaManage(
  mediaId: number,
  user: SessionUser,
): Promise<{ projectId: number; versionId: number }> {
  const media = await prisma.mediaObject.findUnique({
    where: { id: mediaId },
    select: { uploaderId: true, versionId: true },
  });
  if (!media) throw notFound('Média introuvable');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('Accès au projet refusé');
  const manager = user.role === Role.ADMIN || user.role === Role.SUPERVISOR;
  if (!manager && media.uploaderId !== user.id)
    throw forbidden("Suppression réservée à l'uploader ou un superviseur");
  return { projectId, versionId: media.versionId };
}

/** Corbeille (soft-delete) un média. */
export async function trash(user: SessionUser, id: number) {
  const { projectId, versionId } = await assertMediaManage(id, user);
  await softDeleteMedia(id);
  logAudit({ userId: user.id, action: 'MEDIA_DELETE', entityType: 'MediaObject', entityId: id });
  emitToProject(projectId, 'media:update', { projectId, id, versionId });
}

/** Restaure un média depuis la corbeille. */
export async function restore(user: SessionUser, id: number) {
  const { projectId, versionId } = await assertMediaManage(id, user);
  await restoreMedia(id);
  emitToProject(projectId, 'media:update', { projectId, id, versionId });
}

/** Purge définitive d'un média (superviseur+). */
export async function purge(user: SessionUser, id: number) {
  if (user.role !== Role.ADMIN && user.role !== Role.SUPERVISOR)
    throw forbidden('Réservé aux superviseurs/admins');
  const { projectId, versionId } = await assertMediaManage(id, user);
  await purgeMedia(id);
  logAudit({ userId: user.id, action: 'MEDIA_PURGE', entityType: 'MediaObject', entityId: id });
  emitToProject(projectId, 'media:update', { projectId, id, versionId });
}
