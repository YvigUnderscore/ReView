import { Router } from 'express';
import { z } from 'zod';
import { MediaKind, MediaStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { checkProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { storage, StorageService } from '../services/StorageService';
import { validateMediaHeader, getExtension } from '../lib/fileSignatures';
import { resolveProjectIdForVersion, resolveStorageContextForVersion } from '../lib/pipeline';
import { slugifyFilename } from '../lib/slug';
import { softDeleteMedia, restoreMedia, purgeMedia } from '../lib/trash';
import { logAudit } from '../services/AuditService';
import { emitToProject } from '../services/SocketService';
import { enqueueMediaJob } from '../services/JobService';
import { getNumericSetting, SETTING_KEYS } from '../lib/settings';
import { Role } from '@prisma/client';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors';

const router = Router();
router.use(authenticate);

const resolveProjectId = resolveProjectIdForVersion;

/**
 * POST /api/media/upload-url
 * Crée un MediaObject (status UPLOADING) et renvoie une URL présignée PUT pour
 * uploader directement le fichier dans MinIO (non-bloquant, sans toucher le FS serveur).
 */
router.post(
  '/upload-url',
  validate({
    body: z.object({
      versionId: z.number().int(),
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1).max(160),
      kind: z.nativeEnum(MediaKind),
      size: z.number().int().nonnegative().optional(),
    }),
  }),
  async (req, res) => {
    const { versionId, filename, contentType, kind, size } = req.body as {
      versionId: number;
      filename: string;
      contentType: string;
      kind: MediaKind;
      size?: number;
    };
    const storageCtx = await resolveStorageContextForVersion(versionId);
    if (!storageCtx) throw notFound('Version introuvable ou non rattachée à un projet');
    const projectId = storageCtx.projectId;
    if (!(await checkProjectAccess(req.user!.id, req.user!.role, projectId)))
      throw forbidden('Accès au projet refusé');

    // Quotas configurables (admin exempté du quota de stockage)
    const maxFileSize = await getNumericSetting(SETTING_KEYS.MAX_FILE_SIZE);
    if (size && size > maxFileSize) throw badRequest('Fichier trop volumineux', 'FILE_TOO_LARGE');

    const maxConcurrent = await getNumericSetting(SETTING_KEYS.MAX_CONCURRENT_UPLOADS);
    const active = await prisma.mediaObject.count({
      where: { uploaderId: req.user!.id, status: MediaStatus.UPLOADING },
    });
    if (active >= maxConcurrent) throw new AppError("Trop d'uploads simultanés", 429, 'TOO_MANY_UPLOADS');

    if (req.user!.role !== Role.ADMIN) {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { storageLimit: true },
      });
      const limit =
        user?.storageLimit != null
          ? Number(user.storageLimit)
          : await getNumericSetting(SETTING_KEYS.STORAGE_LIMIT_USER);
      const agg = await prisma.mediaObject.aggregate({
        _sum: { size: true },
        where: { uploaderId: req.user!.id },
      });
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
        uploaderId: req.user!.id,
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
    res.status(201).json({ mediaObjectId: media.id, storageKey, uploadUrl });
  },
);

/**
 * POST /api/media/:id/finalize
 * Appelé par le client une fois le PUT terminé. Le serveur lit l'en-tête depuis MinIO,
 * valide les magic bytes, met à jour la taille et passe le statut à READY.
 */
router.post(
  '/:id/finalize',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const media = await prisma.mediaObject.findUnique({ where: { id } });
    if (!media) throw notFound('Média introuvable');

    const projectId = await resolveProjectId(media.versionId);
    if (!projectId || !(await checkProjectAccess(req.user!.id, req.user!.role, projectId))) {
      throw forbidden('Accès au projet refusé');
    }

    const stat = await storage.statObject(media.storageKey);
    const header = await storage.getObjectHeader(media.storageKey, 32);
    const hintExt = getExtension(media.originalName);
    const detected = validateMediaHeader(media.kind, header, hintExt, stat.size);

    if (!detected) {
      await prisma.mediaObject.update({ where: { id }, data: { status: MediaStatus.FAILED } });
      await storage.deleteObject(media.storageKey).catch(() => undefined);
      throw badRequest('Type de fichier invalide (validation magic bytes échouée)', 'INVALID_FILE');
    }

    // Formats 3D convertibles en GLB (model-viewer ne lit que GLB/glTF) — 9.A1
    const CONVERT_3D = ['.fbx', '.obj', '.usd', '.usda', '.usdc', '.dae', '.stl', '.gltf', '.zip', '.usdz'];
    const needs3dConvert = media.kind === MediaKind.MODEL_3D && CONVERT_3D.includes(detected);

    // Vidéo/Image → traitement asynchrone ; 3D non-GLB → conversion ; sinon READY.
    let jobKind: 'transcode' | 'thumbnail' | 'convert3d' | null = null;
    if (media.kind === MediaKind.VIDEO) jobKind = 'transcode';
    else if (media.kind === MediaKind.IMAGE) jobKind = 'thumbnail';
    else if (needs3dConvert) jobKind = 'convert3d';

    const updated = await prisma.mediaObject.update({
      where: { id },
      data: {
        status: jobKind ? MediaStatus.PROCESSING : MediaStatus.READY,
        size: BigInt(stat.size),
      },
    });

    if (jobKind) await enqueueMediaJob({ mediaObjectId: id, kind: jobKind });

    // Compteur de stockage utilisateur (affichage ; le quota utilise la somme live)
    if (media.uploaderId) {
      await prisma.user.update({
        where: { id: media.uploaderId },
        data: { storageUsed: { increment: BigInt(stat.size) } },
      });
    }

    res.json({ media: { ...updated, size: Number(updated.size) }, detectedExtension: detected });
  },
);

/**
 * GET /api/media?projectId=X[&kind=IMAGE] — médias publiés (READY) d'un projet.
 * Sert de bibliothèque (insertion sur le board mood/reference). Membres du projet uniquement.
 */
router.get(
  '/',
  validate({
    query: z.object({ projectId: z.coerce.number().int(), kind: z.nativeEnum(MediaKind).optional() }),
  }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    if (!(await checkProjectAccess(req.user!.id, req.user!.role, projectId)))
      throw forbidden('Accès au projet refusé');
    const kind = req.query.kind as MediaKind | undefined;
    const media = await prisma.mediaObject.findMany({
      where: {
        published: true,
        deletedAt: null,
        status: MediaStatus.READY,
        ...(kind ? { kind } : {}),
        version: {
          OR: [
            { task: { shot: { projectId } } },
            { task: { asset: { projectId } } },
            { asset: { projectId } },
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const items = await Promise.all(
      media.map(async (m) => ({
        id: m.id,
        kind: m.kind,
        originalName: m.originalName,
        thumbnailUrl: m.thumbnailKey ? await storage.getPresignedGetUrl(m.thumbnailKey) : null,
        url: await storage.getPresignedGetUrl(m.storageKey),
      })),
    );
    res.json({ media: items });
  },
);

/**
 * POST /api/media/:id/publish — publie un média brouillon (réservé à l'uploader, admin en secours).
 * Tant que non publié, le média n'est visible que par son uploader.
 */
router.post(
  '/:id/publish',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const media = await prisma.mediaObject.findUnique({ where: { id } });
    if (!media) throw notFound('Média introuvable');
    // Brouillon strictement privé : seul l'uploader voit et publie son média (404 sinon)
    if (media.uploaderId !== req.user!.id) throw notFound('Média introuvable');
    const updated = await prisma.mediaObject.update({ where: { id }, data: { published: true } });
    const projectId = await resolveProjectId(media.versionId);
    if (projectId) emitToProject(projectId, 'media:update', { projectId, id, versionId: media.versionId });
    res.json({ media: { ...updated, size: Number(updated.size) } });
  },
);

/**
 * GET /api/media/drafts — médias brouillons de l'utilisateur courant (non publiés).
 * Alimente la pastille « Brouillons en attente » (publier / supprimer rapidement).
 */
router.get('/drafts', async (req, res) => {
  const drafts = await prisma.mediaObject.findMany({
    where: { published: false, deletedAt: null, uploaderId: req.user!.id },
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
  const items = drafts.map((m) => {
    const v = m.version;
    const t = v?.task;
    // Localisation lisible : « SEQ · SHOT › Tâche » ou « Asset »
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
  res.json({ drafts: items });
});

/**
 * POST /api/media/:id/reprocess — relance le job de traitement (transcode / thumbnail /
 * convert3d) d'un média en échec ou bloqué. Réservé à l'uploader ou superviseur+.
 * Corrige le cas « conversion GLB échouée » sans avoir à ré-uploader.
 */
router.post(
  '/:id/reprocess',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    await assertMediaManage(id, req.user!);
    const media = await prisma.mediaObject.findUnique({ where: { id } });
    if (!media) throw notFound('Média introuvable');
    if (media.status === MediaStatus.UPLOADING) throw badRequest('Upload non finalisé', 'NOT_FINALIZED');

    // Détermine le job à relancer selon le type de média.
    let jobKind: 'transcode' | 'thumbnail' | 'convert3d' | null = null;
    if (media.kind === MediaKind.VIDEO) jobKind = 'transcode';
    else if (media.kind === MediaKind.IMAGE) jobKind = 'thumbnail';
    else if (media.kind === MediaKind.MODEL_3D) {
      const hintExt = getExtension(media.originalName);
      const CONVERT_3D = ['.fbx', '.obj', '.usd', '.usda', '.usdc', '.dae', '.stl', '.gltf', '.zip', '.usdz'];
      if (CONVERT_3D.includes(hintExt)) jobKind = 'convert3d';
    }

    if (!jobKind) {
      // Rien à reconvertir (ex: GLB/glTF natif) → simplement remettre READY.
      const updated = await prisma.mediaObject.update({ where: { id }, data: { status: MediaStatus.READY } });
      return res.json({ media: { ...updated, size: Number(updated.size) }, requeued: false });
    }

    const updated = await prisma.mediaObject.update({
      where: { id },
      data: { status: MediaStatus.PROCESSING },
    });
    await enqueueMediaJob({ mediaObjectId: id, kind: jobKind });
    logAudit({ userId: req.user!.id, action: 'MEDIA_REPROCESS', entityType: 'MediaObject', entityId: id });
    res.json({ media: { ...updated, size: Number(updated.size) }, requeued: true });
  },
);

/**
 * GET /api/media/:id — objet média complet + URLs présignées (original, miniature, proxy).
 */
router.get('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const media = await prisma.mediaObject.findUnique({ where: { id: Number(req.params.id) } });
  if (!media) throw notFound('Média introuvable');
  // Brouillon : visible uniquement par l'uploader (404 sinon pour ne pas divulguer l'existence)
  if (!media.published && media.uploaderId !== req.user!.id) throw notFound('Média introuvable');
  const projectId = await resolveProjectId(media.versionId);
  if (!projectId || !(await checkProjectAccess(req.user!.id, req.user!.role, projectId))) {
    throw forbidden('Accès au projet refusé');
  }
  const meta = (media.metadata ?? {}) as {
    proxyKey?: string;
    glbKey?: string;
    fps?: number;
    width?: number;
    height?: number;
  };
  const [url, thumbnailUrl, proxyUrl, glbUrl, project] = await Promise.all([
    storage.getPresignedGetUrl(media.storageKey),
    media.thumbnailKey ? storage.getPresignedGetUrl(media.thumbnailKey) : Promise.resolve(null),
    meta.proxyKey ? storage.getPresignedGetUrl(meta.proxyKey) : Promise.resolve(null),
    meta.glbKey ? storage.getPresignedGetUrl(meta.glbKey) : Promise.resolve(null),
    prisma.project.findUnique({ where: { id: projectId }, select: { startFrame: true } }),
  ]);
  res.json({
    media: { ...media, size: Number(media.size) },
    url,
    thumbnailUrl,
    proxyUrl,
    glbUrl,
    startFrame: project?.startFrame ?? 1001,
    fps: meta.fps ?? null,
  });
});

/**
 * GET /api/media/:id/url — URL présignée GET pour le serving direct depuis MinIO.
 */
router.get('/:id/url', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const media = await prisma.mediaObject.findUnique({ where: { id: Number(req.params.id) } });
  if (!media) throw notFound('Média introuvable');
  if (!media.published && media.uploaderId !== req.user!.id) throw notFound('Média introuvable');
  const projectId = await resolveProjectId(media.versionId);
  if (!projectId || !(await checkProjectAccess(req.user!.id, req.user!.role, projectId))) {
    throw forbidden('Accès au projet refusé');
  }
  const url = await storage.getPresignedGetUrl(media.storageKey);
  res.json({ url });
});

/** Vérifie que l'utilisateur peut gérer ce média (uploader ou superviseur+) et renvoie le projet. */
const assertMediaManage = async (
  mediaId: number,
  user: { id: number; role: Role },
): Promise<{ projectId: number; versionId: number }> => {
  const media = await prisma.mediaObject.findUnique({
    where: { id: mediaId },
    select: { uploaderId: true, versionId: true },
  });
  if (!media) throw notFound('Média introuvable');
  const projectId = await resolveProjectId(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('Accès au projet refusé');
  const manager = user.role === Role.ADMIN || user.role === Role.SUPERVISOR;
  if (!manager && media.uploaderId !== user.id)
    throw forbidden("Suppression réservée à l'uploader ou un superviseur");
  return { projectId, versionId: media.versionId };
};

// DELETE /api/media/:id — corbeille (soft-delete, uploader ou superviseur+)
router.delete('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const id = Number(req.params.id);
  const { projectId, versionId } = await assertMediaManage(id, req.user!);
  await softDeleteMedia(id);
  logAudit({ userId: req.user!.id, action: 'MEDIA_DELETE', entityType: 'MediaObject', entityId: id });
  emitToProject(projectId, 'media:update', { projectId, id, versionId });
  res.status(204).end();
});

// POST /api/media/:id/restore (uploader ou superviseur+)
router.post(
  '/:id/restore',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const { projectId, versionId } = await assertMediaManage(id, req.user!);
    await restoreMedia(id);
    emitToProject(projectId, 'media:update', { projectId, id, versionId });
    res.status(204).end();
  },
);

// DELETE /api/media/:id/purge — suppression définitive DB + MinIO (superviseur+)
router.delete(
  '/:id/purge',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    if (req.user!.role !== Role.ADMIN && req.user!.role !== Role.SUPERVISOR)
      throw forbidden('Réservé aux superviseurs/admins');
    const id = Number(req.params.id);
    const { projectId, versionId } = await assertMediaManage(id, req.user!);
    await purgeMedia(id);
    logAudit({ userId: req.user!.id, action: 'MEDIA_PURGE', entityType: 'MediaObject', entityId: id });
    emitToProject(projectId, 'media:update', { projectId, id, versionId });
    res.status(204).end();
  },
);

export default router;
