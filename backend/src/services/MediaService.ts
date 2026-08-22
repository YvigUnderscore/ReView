// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus, Prisma, Role, VersionStatus } from '@prisma/client';
import type { Readable } from 'node:stream';
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
import { enqueueMediaJob, enqueueSpatialThumb } from './JobService';
import { jobKindFor, spatialThumbSource } from '../lib/mediaJobKind';
import { getLiveSyncHz, getNumericSetting, SETTING_KEYS } from '../lib/settings';
import { logMediaAccess } from '../lib/mediaAccess';
import { publish as publishApiEvent } from './ApiEventService';
import { notifyChat } from './ChatNotifyService';
import { isClamavEnabled } from '../lib/clamav';
import { hlsContentType } from '../lib/hls';
import {
  HLS_URL_TTL_SEC,
  isSafeHlsName,
  playlistUris,
  signingWindowStart,
  withPlaybackToken,
  withPresignedSegments,
} from '../lib/hlsPlaylist';
import { signMediaPlaybackToken, verifyMediaPlaybackToken } from '../lib/mediaToken';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors';
import { assertNotPublished } from '../lib/publishLock';
import { inheritsPublication, shouldPublishVersion } from '../lib/publishState';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertProjectQuota } from '../lib/projectQuota';
import { logger } from '../lib/logger';
import { assertCanContribute } from '../lib/projectRoles';
import { notifyWatchers } from './WatchService';
import { type PaginationParams, type Paginated, pageArgs, paginate } from '../lib/pagination';
import type { UsdRequest } from './ModelConvertService';
import { enqueuePush } from './shotgrid/ShotgridPushService';

/**
 * Logique métier des médias (upload présigné, finalize/validation magic bytes,
 * publication, reprocess, bibliothèque, corbeille). Les routes ne font que
 * valider → appeler ces fonctions → répondre (cf. 10.D8).
 */

type SessionUser = { id: number; role: Role };

/** Sérialise le `size` BigInt d'un média en Number pour la réponse JSON. */
const serializeMedia = <T extends { size: bigint }>(m: T): Omit<T, 'size'> & { size: number } => ({
  ...m,
  size: Number(m.size),
});

/**
 * Demande la vignette d'un média spatial (3D/splat) — file dédiée, **jamais bloquante** :
 * Redis indisponible ne doit pas faire échouer une finalisation d'upload pour un aperçu.
 */
async function requestSpatialThumb(mediaId: number, kind: MediaKind, ext: string): Promise<void> {
  if (!spatialThumbSource(kind, ext)) return;
  await enqueueSpatialThumb({ mediaObjectId: mediaId }).catch((err: unknown) =>
    logger.warn({ err }, `[Media] vignette spatiale non enfilée media=${mediaId}`),
  );
}

export interface CreateUploadInput {
  versionId: number;
  filename: string;
  contentType: string;
  kind: MediaKind;
  size?: number;
  /** sha256 hex du fichier, calculé côté client (37.B : checksum bout-en-bout + dédup). */
  contentHash?: string;
  /**
   * Scène USD (`MODEL_3D`) : variantes et purpose demandés par le client (45.E). Posé dans
   * `metadata.usdRequest` — la clé que lit le worker `convert3d` et qu'écrit la
   * recomposition — pour que la **première** conversion soit déjà la bonne.
   */
  usdRequest?: UsdRequest;
}

/** Crée un MediaObject (UPLOADING) et renvoie une URL présignée PUT. */
export async function createUpload(user: SessionUser, input: CreateUploadInput) {
  const { versionId, filename, contentType, kind, size } = input;
  const storageCtx = await resolveStorageContextForVersion(versionId);
  if (!storageCtx) throw notFound('Version not found, or not attached to a project');
  const projectId = storageCtx.projectId;
  if (!(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
  await assertCanContribute(user.id, user.role, projectId); // 38.E : CLIENT = pas d'upload
  await assertProjectWritable(projectId); // 38.B : projet archivé = lecture seule

  // Quotas configurables (admin exempté du quota de stockage).
  const maxFileSize = await getNumericSetting(SETTING_KEYS.MAX_FILE_SIZE);
  if (size && size > maxFileSize) throw badRequest('File is too large', 'FILE_TOO_LARGE');

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
    if (used + (size ?? 0) > limit) throw forbidden('Storage quota exceeded', 'STORAGE_LIMIT');
  }

  // Quota de stockage du projet (38.D) — s'applique à tous, admin compris.
  await assertProjectQuota(projectId, size ?? 0);

  // Convention de nommage (38.C) : refus en mode reject, avertissement renvoyé en mode warn.
  const { naming } = await resolveProjectSettingsById(projectId);
  const namingCheck = checkNaming(filename, naming);
  if (!namingCheck.pass && namingCheck.mode === 'reject')
    throw badRequest('Filename does not match the naming rule of this project', 'NAMING_REJECTED');
  const namingWarning = !namingCheck.pass && namingCheck.mode === 'warn';

  // Une version déjà publiée ne retombe pas en brouillon parce qu'on lui ajoute un rendu :
  // le média qui la rejoint naît publié (règle symétrique de `syncVersionPublication`).
  const parentVersion = await prisma.version.findUnique({
    where: { id: versionId },
    select: { published: true },
  });
  const bornPublished = inheritsPublication(parentVersion?.published ?? false);

  const media = await prisma.mediaObject.create({
    data: {
      versionId,
      kind,
      originalName: filename,
      storageKey: '', // rempli juste après avec l'id
      mimeType: contentType,
      status: MediaStatus.UPLOADING,
      published: bornPublished,
      uploaderId: user.id,
      metadata: {
        ...(input.contentHash ? { contentHash: input.contentHash } : {}),
        ...(input.usdRequest ? { usdRequest: input.usdRequest as unknown as Prisma.InputJsonValue } : {}),
      },
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
  if (!media) throw notFound('Media not found');

  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
  // `finalize` relance le pipeline de traitement et réécrit statut et taille : le simple
  // accès au projet ne suffit pas. Il faut pouvoir contribuer (un CLIENT est en lecture
  // seule) et le média ne doit pas être déjà publié (verrou Phase 11).
  await assertCanContribute(user.id, user.role, projectId);
  // Verrou de publication (Phase 11), nuancé depuis que les médias héritent de la
  // publication de leur version : un média encore en UPLOADING n'a jamais été servi à
  // personne, le finaliser est le déroulement normal de son dépôt. Le verrou garde tout
  // son sens pour un média déjà finalisé, dont le contenu, lui, a été diffusé.
  if (media.status !== MediaStatus.UPLOADING) assertNotPublished(media);

  const stat = await storage.statObject(media.storageKey);
  const header = await storage.getObjectHeader(media.storageKey, 32);
  const hintExt = getExtension(media.originalName);
  const detected = validateMediaHeader(media.kind, header, hintExt, stat.size);

  if (!detected) {
    await prisma.mediaObject.update({ where: { id }, data: { status: MediaStatus.FAILED } });
    await storage.deleteObject(media.storageKey).catch(() => undefined);
    throw badRequest('Invalid file type (magic-bytes check failed)', 'INVALID_FILE');
  }

  // Taille RÉELLE de l'objet déposé. Les quotas n'ont été vérifiés qu'à la demande d'URL,
  // contre une taille *déclarée* par le client : annoncer 1 octet puis en téléverser
  // cinquante gigaoctets passait sans jamais être repris.
  const realSize = stat.size;
  const maxFileSize = await getNumericSetting(SETTING_KEYS.MAX_FILE_SIZE);
  if (realSize > maxFileSize) {
    await prisma.mediaObject.update({ where: { id }, data: { status: MediaStatus.FAILED } });
    await storage.deleteObject(media.storageKey).catch(() => undefined);
    throw badRequest('File is too large', 'FILE_TOO_LARGE');
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
  // Aperçu des médias spatiaux : le rendu attend le GLB quand une conversion est en cours.
  await requestSpatialThumb(id, media.kind, detected);

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
  if (!(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
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
      // Clé affichable : une bibliothèque d'EXR renverrait sinon des URL que rien ne rend.
      url: await storage.getPresignedGetUrl(mediaViewKey(m)),
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

/**
 * Aligne l'état publié d'une version sur celui de ses médias (règles dans `lib/publishState`).
 *
 * Appelée après chaque publication de média. Ne dépublie jamais : retirer une version de
 * la diffusion reste une décision de superviseur, pas l'effet de bord d'une suppression.
 */
export async function syncVersionPublication(versionId: number, actorId: number): Promise<boolean> {
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: {
      published: true,
      media: { where: { deletedAt: null }, select: { published: true, status: true } },
    },
  });
  if (!version || version.published) return false;
  if (!shouldPublishVersion(version.media)) return false;

  await prisma.version.update({
    where: { id: versionId },
    data: { published: true, status: VersionStatus.PUBLISHED },
  });
  logAudit({
    userId: actorId,
    action: 'VERSION_PUBLISH',
    entityType: 'Version',
    entityId: versionId,
  });
  return true;
}

/** Publie un média brouillon (réservé à l'uploader). */
export async function publish(user: SessionUser, id: number) {
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Media not found');
  // Brouillon strictement privé : seul l'uploader voit et publie son média (404 sinon).
  if (media.uploaderId !== user.id) throw notFound('Media not found');
  // Un média encore en UPLOADING n'est jamais passé par `finalize` : ni validation des
  // magic bytes, ni normalisation du type de contenu, ni antivirus, ni contrôle de la
  // taille réelle contre les quotas. Le publier ferait servir un contenu jamais vérifié.
  if (media.status === MediaStatus.UPLOADING) throw badRequest('Upload not finalised', 'NOT_FINALIZED');
  const updated = await prisma.mediaObject.update({ where: { id }, data: { published: true } });
  // La version suit ses médias : dès qu'il ne reste plus un brouillon, elle est publiée.
  await syncVersionPublication(media.versionId, user.id);
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (projectId) {
    emitToProject(projectId, 'media:update', { projectId, id, versionId: media.versionId });
    // 48 : la version part vers ShotGrid — création si elle y est inconnue, ajout du
    // média à la version existante sinon. Un média ajouté en cours de route ne doit
    // pas fabriquer un doublon portant le même nom.
    await enqueuePush(projectId, { type: 'version-publish', versionId: media.versionId, actorId: user.id });
    // Suiveurs (32.G) : publication sur la chaîne version/shot/asset.
    await notifyWatchers({
      mediaObjectId: id,
      projectId,
      messageKey: 'notification.mediaPublished',
      params: { name: media.originalName },
      exclude: [user.id],
    });
    // Webhooks sortants (36.D).
    publishApiEvent('media.published', {
      projectId,
      entityType: 'media',
      entityId: id,
      actorId: user.id,
      payload: {
        mediaObjectId: id,
        versionId: media.versionId,
        projectId,
        kind: media.kind,
        originalName: media.originalName,
        publishedBy: user.id,
      },
    });
    // Messagerie d'équipe (42.B — №67).
    void notifyChat(`🎬 Nouveau média publié : ${media.originalName}`);
  }
  return serializeMedia(updated);
}

/** Relance le job de traitement d'un média (échec/bloqué, non publié). */
export async function reprocess(user: SessionUser, id: number) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Media not found');
  if (media.status === MediaStatus.UPLOADING) throw badRequest('Upload not finalised', 'NOT_FINALIZED');
  assertNotPublished(media);

  const ext = getExtension(media.originalName);
  const jobKind = jobKindFor(media.kind, ext);
  if (!jobKind) {
    // Rien à reconvertir (ex : GLB/glTF natif) → simplement remettre READY.
    const updated = await prisma.mediaObject.update({ where: { id }, data: { status: MediaStatus.READY } });
    await requestSpatialThumb(id, media.kind, ext);
    return { media: serializeMedia(updated), requeued: false };
  }

  const updated = await prisma.mediaObject.update({
    where: { id },
    data: { status: MediaStatus.PROCESSING },
  });
  await enqueueMediaJob({ mediaObjectId: id, kind: jobKind });
  await requestSpatialThumb(id, media.kind, ext);
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

/**
 * Clé réellement **affichable** d'un média : le proxy web quand le format d'origine n'est
 * pas rendu par un navigateur (EXR, DPX, TIFF, TGA — cf. `lib/imageProxy`), la source sinon.
 *
 * La distinction avec `mediaSourceKey` est le point d'appui de toute la review d'image de
 * production : le viewer, l'A/B, le wipe et le diff consomment cette clé, tandis que le
 * téléchargement, l'API v1 et les envois ShotGrid continuent de livrer l'original — c'est
 * lui, et lui seul, que l'artiste a déposé.
 */
export function mediaViewKey(media: { storageKey: string; metadata: unknown }): string {
  const meta = (media.metadata ?? {}) as { webProxyKey?: string };
  return typeof meta.webProxyKey === 'string' && meta.webProxyKey.length > 0
    ? meta.webProxyKey
    : mediaSourceKey(media);
}

/** Détail complet d'un média + URLs présignées (original, miniature, proxy, glb). */
export async function getDetail(user: SessionUser, id: number, ip?: string | null) {
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Media not found');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Media not found');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
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
    /** Nom du fichier réellement livré par ShotGrid, quand le média porte le code du site. */
    sourceFilename?: string;
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
  // Image de production (EXR, DPX, TIFF, TGA) : le viewer reçoit le proxy web, jamais
  // l'original — que le navigateur ne décoderait pas. Les deux sont renvoyés : l'un pour
  // regarder, l'autre pour télécharger.
  const viewKey = mediaViewKey(media);
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
    storage.getPresignedGetUrl(viewKey),
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
    // Fichier tel qu'il a été déposé — identique à `url` sauf pour une image de production,
    // où `url` est le proxy JPEG. C'est cette adresse que doit suivre « télécharger ».
    downloadUrl: viewKey === sourceKey ? url : await storage.getPresignedGetUrl(sourceKey),
    // Le média est-il servi par un dérivé plutôt que par son fichier d'origine ? (affichage
    // d'un EXR/DPX/TIFF/TGA : ce qui est à l'écran n'est pas le fichier de référence).
    webProxy: viewKey !== sourceKey,
    thumbnailUrl,
    proxyUrl,
    glbUrl,
    startFrame: project?.startFrame ?? 1001,
    // Provenance de conversion 3D (39.A, étendue 45.C avec le bloc `usd`) : fiche technique.
    modelSource: meta.model ?? null,
    // Le média importé porte le code de la Version ShotGrid ; le nom du fichier livré
    // reste consultable ici — la convention d'un studio y porte souvent une information
    // (espace colorimétrique, encodage) que le code ne reprend pas.
    sourceFilename: meta.sourceFilename ?? null,
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

/**
 * URL présignée GET pour le serving direct depuis MinIO.
 *
 * Sert la clé **affichable** : un EXR renvoyait jusqu'ici une présignée sur le fichier
 * source, que le navigateur ne décode pas — la review affichait un cadre vide.
 * `original: true` réclame le fichier déposé (téléchargement, outillage).
 */
export async function getUrl(user: SessionUser, id: number, opts: { original?: boolean } = {}) {
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Media not found');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Media not found');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
  return storage.getPresignedGetUrl(opts.original ? mediaSourceKey(media) : mediaViewKey(media));
}

/**
 * ── Diffusion HLS (Phase 23, révisée vague 2 : la vidéo ne traverse plus Node) ────────────
 *
 * Avant : chaque segment de 2 s repassait par le process web après trois requêtes Prisma de
 * contrôle d'accès, et repartait en `private, max-age=60` — sur un contenu pourtant
 * immuable. Un plan de dix minutes coûtait ~300 requêtes par rendition et par spectateur,
 * toutes imputées au plafond de débit partagé par IP : c'est ce qui plafonnait les dailies.
 *
 * Maintenant, trois niveaux :
 *  1. `master.m3u8` — l'autorisation en base est payée **ici, une seule fois** (avec le
 *     journal d'accès). Le maître renvoyé accroche un jeton de lecture à chaque rendition.
 *  2. `<rendition>.m3u8?pt=…` — le jeton tient lieu d'autorisation : vérification HMAC,
 *     zéro requête SQL. La sous-playlist renvoyée pointe des URL MinIO présignées.
 *  3. les segments — servis directement par le stockage. Aucun octet de vidéo dans Node.
 *
 * Le proxy historique `/api/media/:id/hls/<segment>.ts` reste servi (client qui n'aurait pas
 * de manifeste réécrit, nom de segment inattendu) : rien ne casse, mais il n'est plus le
 * chemin nominal — et il pose enfin un cache immuable.
 */

/** Réponse d'un fichier HLS : un corps texte (playlist réécrite) ou un flux (repli segment). */
export interface HlsFileResponse {
  contentType: string;
  cacheControl: string;
  body?: string;
  stream?: Readable;
}

/** Un segment ne change jamais : une fois pris, il n'a plus jamais à être redemandé. */
const HLS_SEGMENT_CACHE_CONTROL = 'private, max-age=31536000, immutable';
/** Les playlists portent un jeton et des URL signées : jamais de cache partagé. */
const HLS_PLAYLIST_CACHE_CONTROL = 'private, no-store';

const hlsKey = (id: number, file: string) => `derived/${id}/hls/${file}`;

/** Le contrôle d'accès complet — les trois requêtes que le jeton de lecture évite ensuite. */
async function assertHlsRead(user: SessionUser, id: number): Promise<void> {
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { published: true, uploaderId: true, versionId: true },
  });
  if (!media) throw notFound('Media not found');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Media not found');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
}

async function readHlsText(id: number, file: string): Promise<string> {
  const buf = await storage
    .getObjectBuffer(hlsKey(id, file))
    .catch(() => Promise.reject(notFound('HLS file not found')));
  return buf.toString('utf8');
}

/**
 * Sous-playlists réécrites, **gelées par fenêtre de signature**.
 *
 * Sans cela, deux spectateurs recevraient deux jeux d'URL présignées différents pour les
 * mêmes segments (la signature dépend de l'instant), et aucun cache partagé ne pourrait les
 * rapprocher. En figeant la playlist par fenêtre de quinze minutes, les vingt spectateurs
 * d'un daily demandent exactement les mêmes URL : le frontal ne lit qu'une fois chaque
 * segment au stockage. Corollaire assumé : une échelle HLS régénérée (reprocess) peut être
 * annoncée avec au plus une fenêtre de retard.
 */
const renditionCache = new Map<string, string>();
const RENDITION_CACHE_MAX = 32;

async function presignedRendition(id: number, file: string): Promise<string> {
  const windowStart = signingWindowStart();
  const cacheKey = `${windowStart}:${id}:${file}`;
  const cached = renditionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const text = await readHlsText(id, file);
  const names = playlistUris(text).filter(isSafeHlsName);
  const signed = await Promise.all(
    names.map(
      async (name) => [name, await storage.getPresignedGetUrl(hlsKey(id, name), HLS_URL_TTL_SEC)] as const,
    ),
  );
  const rewritten = withPresignedSegments(text, new Map(signed));

  // Les fenêtres passées ne resserviront jamais ; le reste est borné par ancienneté.
  for (const key of [...renditionCache.keys()])
    if (!key.startsWith(`${windowStart}:`)) renditionCache.delete(key);
  if (renditionCache.size >= RENDITION_CACHE_MAX) {
    const oldest = renditionCache.keys().next().value;
    if (oldest !== undefined) renditionCache.delete(oldest);
  }
  renditionCache.set(cacheKey, rewritten);
  return rewritten;
}

/** Vide le cache des sous-playlists (tests, et point d'entrée si un purgeur en a besoin). */
export function resetHlsPlaylistCache(): void {
  renditionCache.clear();
}

/**
 * Manifeste ou segment HLS (`derived/{id}/hls/{file}`). `file` est validé par la route ;
 * on le revalide ici parce qu'il compose une clé de stockage.
 */
export async function getHlsFile(
  user: SessionUser,
  id: number,
  file: string,
  opts: { playbackToken?: string; ip?: string } = {},
): Promise<HlsFileResponse> {
  if (!isSafeHlsName(file)) throw notFound('HLS file not found');
  const contentType = hlsContentType(file);
  const isMaster = file === 'master.m3u8';
  // Un jeton de lecture valide dispense du contrôle en base ; absent ou invalide (expiré,
  // autre média, autre compte), on refait le contrôle complet — jamais de refus surprise.
  if (isMaster || !verifyMediaPlaybackToken(opts.playbackToken, id, user.id)) await assertHlsRead(user, id);

  if (isMaster) {
    // Journal d'accès (36.E), dédupliqué par fenêtre de 30 min : le visionnage reste tracé
    // alors même que les segments ne passent plus par l'API.
    logMediaAccess({ mediaObjectId: id, userId: user.id, ip: opts.ip ?? null });
    const master = await readHlsText(id, file);
    return {
      contentType,
      cacheControl: HLS_PLAYLIST_CACHE_CONTROL,
      body: withPlaybackToken(master, signMediaPlaybackToken(id, user.id)),
    };
  }

  if (file.endsWith('.m3u8'))
    return {
      contentType,
      cacheControl: HLS_PLAYLIST_CACHE_CONTROL,
      body: await presignedRendition(id, file),
    };

  const stream = await storage
    .getObjectStream(hlsKey(id, file))
    .catch(() => Promise.reject(notFound('HLS file not found')));
  return { contentType, cacheControl: HLS_SEGMENT_CACHE_CONTROL, stream };
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
  if (!m) throw badRequest('Invalid thumbnail (an image data URL is expected)', 'INVALID_THUMBNAIL');
  const contentType = m[1]!.toLowerCase();
  const buf = Buffer.from(m[2]!, 'base64');
  if (buf.length === 0 || buf.length > MAX_THUMBNAIL_BYTES)
    throw badRequest('Thumbnail is empty or too large', 'INVALID_THUMBNAIL');
  if (!detectImage(buf.subarray(0, 16)))
    throw badRequest('Thumbnail content is not a recognised image', 'INVALID_THUMBNAIL');
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  return { buf, contentType, ext };
}

export async function setThumbnail(user: SessionUser, id: number, dataUrl: string) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({ where: { id }, select: { published: true } });
  if (!media) throw notFound('Media not found');
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
  if (!media) throw notFound('Media not found');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Media not found');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
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
  if (!media) throw notFound('Media not found');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
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
    throw forbidden('Supervisors and administrators only');
  const { projectId, versionId } = await assertMediaManage(id, user);
  await purgeMedia(id);
  logAudit({ userId: user.id, action: 'MEDIA_PURGE', entityType: 'MediaObject', entityId: id });
  emitToProject(projectId, 'media:update', { projectId, id, versionId });
}
