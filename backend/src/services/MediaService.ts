// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { checkProjectAccess } from '../middleware/rbac';
import { storage, StorageService } from './StorageService';
import { validateMediaHeader, getExtension, detectImage } from '../lib/fileSignatures';
import { resolveProjectIdForVersion, resolveStorageContextForVersion } from '../lib/pipeline';
import { resolveProjectSettingsById, checkNaming } from '../lib/projectSettings';
import { slugifyFilename } from '../lib/slug';
import { softDeleteMedia, restoreMedia, purgeMedia } from '../lib/trash';
import { logAudit } from './AuditService';
import { emitToProject } from './SocketService';
import { enqueueMediaJob } from './JobService';
import { getLiveSyncHz, getNumericSetting, SETTING_KEYS } from '../lib/settings';
import { logMediaAccess } from '../lib/mediaAccess';
import { emitWebhookEvent } from './WebhookService';
import { notifyChat } from './ChatNotifyService';
import { isClamavEnabled } from '../lib/clamav';
import { hlsContentType } from '../lib/hls';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors';
import { assertNotPublished } from '../lib/publishLock';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertProjectQuota } from '../lib/projectQuota';
import { logger } from '../lib/logger';
import { assertCanContribute } from '../lib/projectRoles';
import { notifyWatchers } from './WatchService';
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
  /** sha256 hex du fichier, calculé côté client (37.B : checksum bout-en-bout + dédup). */
  contentHash?: string;
}

/** Crée un MediaObject (UPLOADING) et renvoie une URL présignée PUT. */
export async function createUpload(user: SessionUser, input: CreateUploadInput) {
  const { versionId, filename, contentType, kind, size } = input;
  const storageCtx = await resolveStorageContextForVersion(versionId);
  if (!storageCtx) throw notFound('Version introuvable ou non rattachée à un projet');
  const projectId = storageCtx.projectId;
  if (!(await checkProjectAccess(user.id, user.role, projectId))) throw forbidden('Accès au projet refusé');
  await assertCanContribute(user.id, user.role, projectId); // 38.E : CLIENT = pas d'upload
  await assertProjectWritable(projectId); // 38.B : projet archivé = lecture seule

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

  // Quota de stockage du projet (38.D) — s'applique à tous, admin compris.
  await assertProjectQuota(projectId, size ?? 0);

  // Convention de nommage (38.C) : refus en mode reject, avertissement renvoyé en mode warn.
  const { naming } = await resolveProjectSettingsById(projectId);
  const namingCheck = checkNaming(filename, naming);
  if (!namingCheck.pass && namingCheck.mode === 'reject')
    throw badRequest('Nom de fichier non conforme à la nomenclature du projet', 'NAMING_REJECTED');
  const namingWarning = !namingCheck.pass && namingCheck.mode === 'warn';

  const media = await prisma.mediaObject.create({
    data: {
      versionId,
      kind,
      originalName: filename,
      storageKey: '', // rempli juste après avec l'id
      mimeType: contentType,
      status: MediaStatus.UPLOADING,
      uploaderId: user.id,
      metadata: input.contentHash ? { contentHash: input.contentHash } : {},
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
  return { mediaObjectId: media.id, storageKey, uploadUrl, namingWarning };
}

/** Finalise un upload : valide les magic bytes, met la taille à jour, déclenche le traitement. */
export async function finalize(user: SessionUser, id: number) {
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Média introuvable');

  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('Accès au projet refusé');
  // `finalize` relance le pipeline de traitement et réécrit statut et taille : le simple
  // accès au projet ne suffit pas. Il faut pouvoir contribuer (un CLIENT est en lecture
  // seule) et le média ne doit pas être déjà publié (verrou Phase 11).
  await assertCanContribute(user.id, user.role, projectId);
  assertNotPublished(media);

  const stat = await storage.statObject(media.storageKey);
  const header = await storage.getObjectHeader(media.storageKey, 32);
  const hintExt = getExtension(media.originalName);
  const detected = validateMediaHeader(media.kind, header, hintExt, stat.size);

  if (!detected) {
    await prisma.mediaObject.update({ where: { id }, data: { status: MediaStatus.FAILED } });
    await storage.deleteObject(media.storageKey).catch(() => undefined);
    throw badRequest('Type de fichier invalide (validation magic bytes échouée)', 'INVALID_FILE');
  }

  // Taille RÉELLE de l'objet déposé. Les quotas n'ont été vérifiés qu'à la demande d'URL,
  // contre une taille *déclarée* par le client : annoncer 1 octet puis en téléverser
  // cinquante gigaoctets passait sans jamais être repris.
  const realSize = stat.size;
  const maxFileSize = await getNumericSetting(SETTING_KEYS.MAX_FILE_SIZE);
  if (realSize > maxFileSize) {
    await prisma.mediaObject.update({ where: { id }, data: { status: MediaStatus.FAILED } });
    await storage.deleteObject(media.storageKey).catch(() => undefined);
    throw badRequest('Fichier trop volumineux', 'FILE_TOO_LARGE');
  }
  try {
    await assertProjectQuota(projectId, realSize);
  } catch (err) {
    await prisma.mediaObject.update({ where: { id }, data: { status: MediaStatus.FAILED } });
    await storage.deleteObject(media.storageKey).catch(() => undefined);
    throw err;
  }

  // Le type stocké est arrêté ici, côté serveur : celui passé à la signature du PUT n'est
  // pas contraignant (le presigner ne signe que `host`), le navigateur a donc pu déposer
  // l'objet en `text/html`. Les objets étant servis depuis l'origine de l'app, on le ramène
  // à une valeur inerte avant que le média ne devienne lisible.
  await storage
    .setObjectContentType(media.storageKey, stat.contentType ?? '')
    .catch((err) => logger.warn({ err, key: media.storageKey }, '[Media] type de contenu non normalisé'));

  const jobKind = jobKindFor(media.kind, detected);
  const updated = await prisma.mediaObject.update({
    where: { id },
    data: { status: jobKind ? MediaStatus.PROCESSING : MediaStatus.READY, size: BigInt(stat.size) },
  });
  if (jobKind) await enqueueMediaJob({ mediaObjectId: id, kind: jobKind });
  // 37.E : les médias servis tels quels (GLB natif, splats) passent quand même à
  // l'antivirus — READY tout de suite, quarantaine a posteriori si détection.
  else if (isClamavEnabled()) await enqueueMediaJob({ mediaObjectId: id, kind: 'scan' });

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
      url: await storage.getPresignedGetUrl(mediaSourceKey(m)),
    })),
  );
  return paginate(items, total, p);
}

export interface ReviewsFilter {
  projectId?: number;
  kind?: MediaKind;
  status?: 'published' | 'draft';
  /** Filtre par décision de review courante : id de ReviewStatus, ou 'none' = sans décision. */
  decision?: number | 'none';
}

/**
 * Page « Reviews » globale (12.C) : médias publiés (READY) de tous mes projets
 * + mes propres brouillons, cross-projets par membership (ADMIN/SUPERVISOR = tous),
 * filtrables par projet/type/statut, tri du plus récent au plus ancien.
 */
export async function listReviews(
  user: SessionUser,
  filter: ReviewsFilter,
  p: PaginationParams,
): Promise<Paginated<unknown>> {
  const isGlobal = user.role === Role.ADMIN || user.role === Role.SUPERVISOR;
  const project: Prisma.ProjectWhereInput = {
    deletedAt: null,
    ...(filter.projectId ? { id: filter.projectId } : {}),
    ...(isGlobal ? {} : { memberships: { some: { userId: user.id } } }),
  };
  // Visibilité : les brouillons ne sont montrés qu'à leur uploader (même sémantique que getDetail).
  const visibility: Prisma.MediaObjectWhereInput =
    filter.status === 'draft'
      ? { published: false, uploaderId: user.id }
      : filter.status === 'published'
        ? { published: true }
        : { OR: [{ published: true }, { published: false, uploaderId: user.id }] };
  const where: Prisma.MediaObjectWhereInput = {
    deletedAt: null,
    status: MediaStatus.READY,
    ...(filter.kind ? { kind: filter.kind } : {}),
    version: {
      deletedAt: null,
      ...(filter.decision === 'none'
        ? { reviewStatusId: null }
        : filter.decision !== undefined
          ? { reviewStatusId: filter.decision }
          : {}),
      OR: [
        { task: { shot: { deletedAt: null, project } } },
        { task: { asset: { deletedAt: null, project } } },
        { asset: { deletedAt: null, project } },
      ],
    },
    AND: [visibility],
  };
  const projectSelect = { select: { id: true, name: true } };
  const [media, total] = await Promise.all([
    prisma.mediaObject.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...pageArgs(p),
      include: {
        uploader: { select: { id: true, name: true } },
        version: {
          select: {
            name: true,
            reviewStatus: { select: { id: true, name: true, color: true } },
            task: {
              select: {
                name: true,
                shot: {
                  select: { code: true, sequence: { select: { code: true } }, project: projectSelect },
                },
                asset: { select: { name: true, project: projectSelect } },
              },
            },
            asset: { select: { name: true, project: projectSelect } },
          },
        },
      },
    }),
    prisma.mediaObject.count({ where }),
  ]);
  const items = await Promise.all(
    media.map(async (m) => {
      const t = m.version?.task;
      const location = t?.shot
        ? `${t.shot.sequence ? t.shot.sequence.code + ' · ' : ''}${t.shot.code} › ${t.name}`
        : t?.asset
          ? `${t.asset.name} › ${t.name}`
          : (m.version?.asset?.name ?? '');
      const project = t?.shot?.project ?? t?.asset?.project ?? m.version?.asset?.project ?? null;
      // Sprite de miniatures pour l'aperçu animé au survol des cartes (42.A — №78, vidéo).
      const meta = (m.metadata ?? {}) as {
        timelineSprite?: { key: string; count: number; cols: number; rows: number };
      };
      const ts = m.kind === MediaKind.VIDEO ? meta.timelineSprite : undefined;
      return {
        id: m.id,
        kind: m.kind,
        name: m.originalName,
        published: m.published,
        createdAt: m.createdAt,
        thumbnailUrl: m.thumbnailKey ? await storage.getPresignedGetUrl(m.thumbnailKey) : null,
        hoverSprite: ts
          ? {
              url: await storage.getPresignedGetUrl(ts.key),
              count: ts.count,
              cols: ts.cols,
              rows: ts.rows,
            }
          : null,
        location,
        versionName: m.version?.name ?? '',
        reviewStatus: m.version?.reviewStatus ?? null,
        project,
        uploader: m.uploader?.name ?? null,
      };
    }),
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
  if (projectId) {
    emitToProject(projectId, 'media:update', { projectId, id, versionId: media.versionId });
    // Suiveurs (32.G) : publication sur la chaîne version/shot/asset.
    await notifyWatchers({
      mediaObjectId: id,
      projectId,
      content: `Nouveau média publié : ${media.originalName}`,
      exclude: [user.id],
    });
    // Webhooks sortants (36.D).
    emitWebhookEvent('media.published', {
      mediaObjectId: id,
      versionId: media.versionId,
      projectId,
      kind: media.kind,
      originalName: media.originalName,
      publishedBy: user.id,
    });
    // Messagerie d'équipe (42.B — №67).
    notifyChat(`🎬 Nouveau média publié : ${media.originalName}`);
  }
  return serializeMedia(updated);
}

/** Relance le job de traitement d'un média (échec/bloqué, non publié). */
export async function reprocess(user: SessionUser, id: number) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Média introuvable');
  if (media.status === MediaStatus.UPLOADING) throw badRequest('Upload non finalisé', 'NOT_FINALIZED');
  assertNotPublished(media);

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

/**
 * Clé « source » réellement servie d'un média : après transcodage vidéo, l'original est
 * supprimé (gain de place) et le proxy MP4 devient la source.
 */
export function mediaSourceKey(media: { storageKey: string; metadata: unknown }): string {
  const meta = (media.metadata ?? {}) as { proxyKey?: string; sourceDeleted?: boolean };
  return meta.sourceDeleted && meta.proxyKey ? meta.proxyKey : media.storageKey;
}

/** Détail complet d'un média + URLs présignées (original, miniature, proxy, glb). */
export async function getDetail(user: SessionUser, id: number, ip?: string | null) {
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Média introuvable');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Média introuvable');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('Accès au projet refusé');
  // Journal d'accès (36.E) : la review charge ce détail à l'ouverture — dédup 30 min.
  logMediaAccess({ mediaObjectId: id, userId: user.id, ip: ip ?? null });
  const meta = (media.metadata ?? {}) as {
    proxyKey?: string;
    sourceDeleted?: boolean;
    glbKey?: string;
    // `usd` (45.C) : description de la scène — couche racine, variantes, assets manquants.
    model?: { sourceFormat: string; converter: string; native: boolean; usd?: unknown };
    // Raison d'un échec de traitement (45.C) — affichée en review plutôt qu'un `FAILED` muet.
    processingError?: string;
    // Override de scène (46.D) : mise en scène rejouée à l'ouverture pour tous.
    usdOverride?: unknown;
    fps?: number;
    width?: number;
    height?: number;
    splatEdits?: unknown;
    splatMaskKey?: string;
    splatMaskCount?: number;
    splatSubsetKey?: string;
    splatSubsetCount?: number;
    splatPresentation?: unknown;
    trim?: { inFrame: number; outFrame: number };
    trimProxyKey?: string;
    hls?: { renditions: { height: number; width: number; videoBitrateK: number }[] };
    timelineSprite?: {
      key: string;
      intervalSec: number;
      count: number;
      cols: number;
      rows: number;
      tileW: number;
      tileH: number;
    };
  };
  // Proxy trimé (10.G-V10) : sert la coupe non-destructive à tous dès qu'elle est produite.
  const proxyKey = meta.trim && meta.trimProxyKey ? meta.trimProxyKey : meta.proxyKey;
  const sourceKey = mediaSourceKey(media);
  const [
    url,
    thumbnailUrl,
    proxyUrl,
    glbUrl,
    splatMaskUrl,
    splatSubsetUrl,
    timelineSpriteUrl,
    project,
    projectSettings,
    references,
  ] = await Promise.all([
    storage.getPresignedGetUrl(sourceKey),
    media.thumbnailKey ? storage.getPresignedGetUrl(media.thumbnailKey) : Promise.resolve(null),
    proxyKey ? storage.getPresignedGetUrl(proxyKey) : Promise.resolve(null),
    meta.glbKey ? storage.getPresignedGetUrl(meta.glbKey) : Promise.resolve(null),
    meta.splatMaskKey ? storage.getPresignedGetUrl(meta.splatMaskKey) : Promise.resolve(null),
    meta.splatSubsetKey ? storage.getPresignedGetUrl(meta.splatSubsetKey) : Promise.resolve(null),
    meta.timelineSprite?.key ? storage.getPresignedGetUrl(meta.timelineSprite.key) : Promise.resolve(null),
    prisma.project.findUnique({ where: { id: projectId }, select: { startFrame: true } }),
    // Éclairage HDRI par défaut du projet (39.F) : rejoué si le média n'a pas le sien.
    resolveProjectSettingsById(projectId),
    // Images de référence (Phase 24, multi-items) — lecture inline (le service référence
    // assertMediaManage d'ici : un import croisé créerait un cycle).
    prisma.reviewReference.findMany({ where: { mediaObjectId: id }, orderBy: { id: 'asc' } }).then((rows) =>
      Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          url: await storage.getPresignedGetUrl(r.storageKey),
          x: r.x,
          y: r.y,
          width: r.width,
          // Commentaire porteur : affichée seulement quand il est sélectionné (null = historique).
          commentId: r.commentId,
        })),
      ),
    ),
  ]);
  return {
    media: serializeMedia(media),
    // Projet porteur : évite au front une résolution séparée (mentions, liens profonds).
    projectId,
    url,
    thumbnailUrl,
    proxyUrl,
    glbUrl,
    startFrame: project?.startFrame ?? 1001,
    // Provenance de conversion 3D (39.A, étendue 45.C avec le bloc `usd`) : fiche technique.
    modelSource: meta.model ?? null,
    // Raison de l'échec quand le média est FAILED (45.C) : asset USD manquant, outillage absent…
    processingError: meta.processingError ?? null,
    // Override de scène (46.D) — rejoué au chargement du viewer 3D pour tous les spectateurs.
    usdOverride: meta.usdOverride ?? null,
    fps: meta.fps ?? null,
    // Fréquence de diffusion de la salle live (33.B), réglable admin par type de média.
    liveSyncHz: await getLiveSyncHz(media.kind),
    // Éditions splat non-destructives (10.G) : JSON + masque binaire (SplatEditService).
    splatEdits: meta.splatEdits ?? null,
    splatMaskUrl,
    splatMaskCount: meta.splatMaskCount ?? 0,
    // Transformations de sous-ensembles (Phase 28) : ops binaires rejouées au chargement.
    splatSubsetUrl,
    splatSubsetCount: meta.splatSubsetCount ?? 0,
    // Présentation persistée (10.G-V5) : caméra/DoF/reveal/LOD/animation, rejouée pour tous.
    splatPresentation: meta.splatPresentation ?? null,
    // Éclairage HDRI par défaut du projet (39.F) : repli quand le média n'a pas le sien.
    projectDefaultLighting: projectSettings.defaultLighting ?? null,
    // Gestion de couleur OCIO du projet (39.B) : intention display/view (badge review).
    projectColor: projectSettings.color ?? null,
    // Trim vidéo non-destructif (10.G-V10) : bornes + proxy trimé prêt ou en cours.
    trim: meta.trim ?? null,
    trimProxyReady: Boolean(meta.trim && meta.trimProxyKey),
    // HLS adaptatif (Phase 23) : présent → master servi via /api/media/:id/hls/master.m3u8.
    hls: meta.hls ?? null,
    // Sprite de miniatures de la timeline (vignette ~toutes les 3 s, un seul JPEG).
    timelineSprite: meta.timelineSprite
      ? {
          intervalSec: meta.timelineSprite.intervalSec,
          count: meta.timelineSprite.count,
          cols: meta.timelineSprite.cols,
          rows: meta.timelineSprite.rows,
          tileW: meta.timelineSprite.tileW,
          tileH: meta.timelineSprite.tileH,
        }
      : null,
    timelineSpriteUrl,
    // Images de référence review 2D (Phase 24, multi-items) : persistées & partagées.
    references,
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
  return storage.getPresignedGetUrl(mediaSourceKey(media));
}

/**
 * Flux d'un fichier HLS (`derived/{id}/hls/{file}`) — proxy auth (Phase 23) : les playlists
 * référencent des URI relatifs, servis derrière `/api/media/:id/hls/:file`. `file` est validé
 * par la route (pas de traversée). Accès lecture (média publié ou uploader + membre projet).
 */
export async function getHlsFile(user: SessionUser, id: number, file: string) {
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { published: true, uploaderId: true, versionId: true },
  });
  if (!media) throw notFound('Média introuvable');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Média introuvable');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('Accès au projet refusé');
  const stream = await storage
    .getObjectStream(`derived/${id}/hls/${file}`)
    .catch(() => Promise.reject(notFound('Fichier HLS introuvable')));
  return { stream, contentType: hlsContentType(file) };
}

const MAX_THUMBNAIL_BYTES = 1_500_000;

/**
 * Enregistre une miniature fournie par le client (capture d'un rendu ou fichier choisi).
 * Data URL image/jpeg|png|webp base64, validée par magic bytes, stockée dans MinIO,
 * référencée par `thumbnailKey`. Réservé aux gestionnaires du média (uploader/superviseur+).
 * La miniature est de la **présentation** (comme `splatPresentation`) : elle reste
 * modifiable après publication — exception assumée au verrou Phase 11 (le contenu du
 * média, lui, reste figé).
 */
/** Décode + valide une data URL image base64 → buffer + type + extension (lève si invalide). */
function decodeThumbnailDataUrl(dataUrl: string): { buf: Buffer; contentType: string; ext: string } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(dataUrl);
  if (!m) throw badRequest('Miniature invalide (data URL image attendue)', 'INVALID_THUMBNAIL');
  const contentType = m[1]!.toLowerCase();
  const buf = Buffer.from(m[2]!, 'base64');
  if (buf.length === 0 || buf.length > MAX_THUMBNAIL_BYTES)
    throw badRequest('Miniature vide ou trop volumineuse', 'INVALID_THUMBNAIL');
  if (!detectImage(buf.subarray(0, 16)))
    throw badRequest('Contenu de miniature non reconnu comme image', 'INVALID_THUMBNAIL');
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  return { buf, contentType, ext };
}

export async function setThumbnail(user: SessionUser, id: number, dataUrl: string) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({ where: { id }, select: { published: true } });
  if (!media) throw notFound('Média introuvable');
  const { buf, contentType, ext } = decodeThumbnailDataUrl(dataUrl);
  const key = StorageService.thumbnailKey(id, ext);
  await storage.putObject(key, buf, contentType);
  await prisma.mediaObject.update({ where: { id }, data: { thumbnailKey: key } });
  return { thumbnailUrl: await storage.getPresignedGetUrl(key) };
}

/**
 * Miniature **auto** capturée côté client à la 1re visualisation d'un média 3D/splat (pas de
 * rendu headless serveur). Bootstrap idempotent : n'écrit que si `thumbnailKey` est **absent**
 * (jamais d'écrasement — n'entre donc pas en conflit avec le verrou de publication : on remplit
 * un aperçu manquant, on ne modifie pas le média). Accès lecture suffisant (tout membre du
 * projet qui voit le média). Concurrence gérée par un update conditionnel (une seule écriture).
 */
export async function setAutoThumbnail(user: SessionUser, id: number, dataUrl: string) {
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { published: true, uploaderId: true, versionId: true, thumbnailKey: true },
  });
  if (!media) throw notFound('Média introuvable');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Média introuvable');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('Accès au projet refusé');
  // Déjà une miniature (worker ou capture concurrente) : on ne touche à rien.
  if (media.thumbnailKey) {
    return { thumbnailUrl: await storage.getPresignedGetUrl(media.thumbnailKey), created: false };
  }
  const { buf, contentType, ext } = decodeThumbnailDataUrl(dataUrl);
  const key = StorageService.thumbnailKey(id, ext);
  await storage.putObject(key, buf, contentType);
  // Écriture conditionnelle : ne pose la clé que si toujours nulle (anti-course).
  const { count } = await prisma.mediaObject.updateMany({
    where: { id, thumbnailKey: null },
    data: { thumbnailKey: key },
  });
  if (count === 0) {
    // Une capture concurrente a gagné : on supprime notre objet et on renvoie la sienne.
    await storage.deleteObject(key).catch(() => undefined);
    const fresh = await prisma.mediaObject.findUnique({ where: { id }, select: { thumbnailKey: true } });
    const url = fresh?.thumbnailKey ? await storage.getPresignedGetUrl(fresh.thumbnailKey) : null;
    return { thumbnailUrl: url, created: false };
  }
  return { thumbnailUrl: await storage.getPresignedGetUrl(key), created: true };
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
