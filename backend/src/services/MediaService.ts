// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus, Prisma, Role, VersionStatus } from '@prisma/client';
import type { Readable } from 'node:stream';
import { prisma } from '../lib/prisma';
import { checkProjectAccess } from '../middleware/rbac';
import { storage, StorageService } from './StorageService';
import { validateMediaHeader, getExtension, detectImage } from '../lib/fileSignatures';
import { resolveProjectIdForVersion, resolveStorageContextForVersion } from '../lib/pipeline';
import { checkNaming, resolveProjectSettingsById } from '../lib/projectSettings';
import { resolveDeliveryAspect } from '../lib/deliveryAspect';
import { assertUploadNote } from '../lib/uploadNote';
import { slugifyFilename } from '../lib/slug';
import { softDeleteMedia, restoreMedia, purgeMedia } from '../lib/trash';
import { logAudit } from './AuditService';
import { emitToProject } from './SocketService';
import { enqueueMediaJob, enqueueSpatialThumb } from './JobService';
import { jobKindFor, spatialThumbSource } from '../lib/mediaJobKind';
import { getLiveSyncHz, getNumericSetting, isDraftModeEnabled, SETTING_KEYS } from '../lib/settings';
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
import { assertReprocessable, assertWritable, withPublishedReprocess } from '../lib/publishLock';
import { canEditVersionTransform } from '../lib/versionPermissions';
import { bornsPublished, shouldPublishVersion } from '../lib/publishState';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertProjectQuota } from '../lib/projectQuota';
import { logger } from '../lib/logger';
import { assertCanContribute, isProjectManager } from '../lib/projectRoles';
import { notifyWatchers } from './WatchService';
import { listReviewers, setReviewers, type ReviewerInput } from './ReviewAssignmentService';
import { type PaginationParams, type Paginated, pageArgs, paginate } from '../lib/pagination';
import type { UsdRequest } from './ModelConvertService';
import { enqueuePush } from './shotgrid/ShotgridPushService';

/**
 * Media business logic: presigned upload, finalize with magic-byte validation,
 * publication, reprocess, library and trash. Routes only validate, call these
 * functions, then respond.
 */

type SessionUser = { id: number; role: Role };

/** Serializes a media's BigInt `size` to a Number for the JSON response. */
const serializeMedia = <T extends { size: bigint }>(m: T): Omit<T, 'size'> & { size: number } => ({
  ...m,
  size: Number(m.size),
});

/**
 * Requests the thumbnail of a spatial media (3D/splat). Runs on a dedicated
 * queue and never blocks: Redis being down must not fail an upload finalize.
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
  /** SHA-256 hex of the file, computed client-side (37.B: end-to-end checksum and dedup). */
  contentHash?: string;
  /**
   * USD scene (`MODEL_3D`): variants and purpose requested by the client (45.E). Stored in
   * `metadata.usdRequest`, the key read by the `convert3d` worker and written by the
   * recomposition, so the first conversion is already the right one.
   */
  usdRequest?: UsdRequest;
}

/** Creates a MediaObject (UPLOADING) and returns a presigned PUT URL. */
export async function createUpload(user: SessionUser, input: CreateUploadInput) {
  const { versionId, filename, contentType, kind, size } = input;
  const storageCtx = await resolveStorageContextForVersion(versionId);
  if (!storageCtx) throw notFound('Version not found, or not attached to a project');
  const projectId = storageCtx.projectId;
  if (!(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
  await assertCanContribute(user.id, user.role, projectId); // 38.E: CLIENT cannot upload
  await assertProjectWritable(projectId); // 38.B: archived project is read-only

  // Configurable quotas (admins are exempt from the storage quota).
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

  // Project storage quota (38.D), applied to everyone, admins included.
  await assertProjectQuota(projectId, size ?? 0);

  // Naming convention (38.C): rejected in reject mode, warning returned in warn mode.
  const { naming } = await resolveProjectSettingsById(projectId);
  const namingCheck = checkNaming(filename, naming);
  if (!namingCheck.pass && namingCheck.mode === 'reject')
    throw badRequest('Filename does not match the naming rule of this project', 'NAMING_REJECTED');
  const namingWarning = !namingCheck.pass && namingCheck.mode === 'warn';

  // Automatic publication (Phase 50): outside draft mode a media is born published, so
  // uploading IS delivering. In active draft mode the historical rule still applies: only an
  // already-published version yields a published media at birth, so it does not fall back to
  // draft when a render is added (symmetric with `syncVersionPublication`).
  const parentVersion = await prisma.version.findUnique({
    where: { id: versionId },
    select: { published: true },
  });
  const bornPublished = bornsPublished({
    draftMode: await isDraftModeEnabled(),
    versionPublished: parentVersion?.published ?? false,
  });

  const media = await prisma.mediaObject.create({
    data: {
      versionId,
      kind,
      originalName: filename,
      storageKey: '', // filled right after with the id
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
  // `published` is returned so the caller knows, without reading an admin setting that is
  // closed to it, whether "publish" is still a gesture to offer after upload.
  return { mediaObjectId: media.id, storageKey, uploadUrl, namingWarning, published: bornPublished };
}

/**
 * Finalizes an upload: validates magic bytes, updates the size, triggers processing.
 *
 * `note` is the upload brief: what the author says about what they deliver. It is only
 * mandatory if the project requires it (`settings.reviewRequest.requireNote`); when given,
 * it is kept in `metadata.uploadNote` and shown in the media detail.
 */
export async function finalize(user: SessionUser, id: number, note?: string | null) {
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Media not found');

  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
  // `finalize` re-runs the processing pipeline and rewrites status and size: simply having
  // project access is not enough. The caller must be able to contribute (a CLIENT is
  // read-only) and the media must not already be published (Phase 11 lock).
  await assertCanContribute(user.id, user.role, projectId);
  // Publication lock (Phase 11), refined now that media inherit their version's publication:
  // a media still UPLOADING was never served to anyone, so finalizing it is the normal course
  // of its upload. The lock keeps its full meaning for an already-finalized media, whose
  // content has been distributed.
  if (media.status !== MediaStatus.UPLOADING) assertWritable(media, 'uploadFinalize');

  // Upload brief: checked BEFORE any write and before any storage call. Refusing it later
  // would mark the media FAILED and delete the deposited object over a missing sentence,
  // whereas re-calling `finalize` with the note is enough.
  const [draftMode, projectSettings] = await Promise.all([
    isDraftModeEnabled(),
    resolveProjectSettingsById(projectId),
  ]);
  const uploadNote = assertUploadNote(note, projectSettings.reviewRequest);

  const stat = await storage.statObject(media.storageKey);
  const header = await storage.getObjectHeader(media.storageKey, 32);
  const hintExt = getExtension(media.originalName);
  const detected = validateMediaHeader(media.kind, header, hintExt, stat.size);

  if (!detected) {
    await prisma.mediaObject.update({ where: { id }, data: { status: MediaStatus.FAILED } });
    await storage.deleteObject(media.storageKey).catch(() => undefined);
    throw badRequest('Invalid file type (magic-bytes check failed)', 'INVALID_FILE');
  }

  // REAL size of the deposited object. Quotas were only checked when the URL was requested,
  // against a *declared* size: announcing 1 byte then uploading 50 GB passed unnoticed.
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

  // The stored type is fixed here, server-side: the one passed to the PUT signature is not
  // binding (the presigner only signs `host`), so the browser could have stored `text/html`.
  // Objects are served from the app origin, so reset it to an inert value before the media
  // becomes readable.
  await storage
    .setObjectContentType(media.storageKey, stat.contentType ?? '')
    .catch((err) => logger.warn({ err, key: media.storageKey }, '[Media] type de contenu non normalisé'));

  const jobKind = jobKindFor(media.kind, detected);
  const updated = await prisma.mediaObject.update({
    where: { id },
    data: {
      status: jobKind ? MediaStatus.PROCESSING : MediaStatus.READY,
      size: BigInt(stat.size),
      // The brief joins the media metadata: it is what the author said about their delivery
      // and must survive even if nobody is assigned yet.
      ...(uploadNote
        ? { metadata: { ...((media.metadata ?? {}) as Record<string, unknown>), uploadNote } }
        : {}),
    },
  });
  if (jobKind) await enqueueMediaJob({ mediaObjectId: id, kind: jobKind });
  // 37.E: media served as-is (native GLB, splats) still go through the antivirus: READY right
  // away, quarantined afterwards if a detection occurs.
  else if (isClamavEnabled()) await enqueueMediaJob({ mediaObjectId: id, kind: 'scan' });
  // Spatial media preview: rendering waits for the GLB when a conversion is in progress.
  await requestSpatialThumb(id, media.kind, detected);

  // User storage counter (display only; the quota uses the live sum).
  if (media.uploaderId) {
    await prisma.user.update({
      where: { id: media.uploaderId },
      data: { storageUsed: { increment: BigInt(stat.size) } },
    });
  }

  // Automatic publication: the media was born published, so THIS is where it becomes a
  // delivery: the version follows its media, the team is notified, integrations fire.
  // In draft mode none of this happens: "publish" stays a gesture and it is that which
  // announces, exactly as before this batch.
  if (updated.published && !draftMode) await announcePublication(updated, projectId, user.id);

  return { media: serializeMedia(updated), detectedExtension: detected };
}

/**
 * Number of signed lines in a row before yielding back to the event loop.
 *
 * WHY: `getSignedUrl` returns a promise, but SigV4 signing is a chain of HMAC-SHA256 steps
 * that resolve in microtasks, so the loop never gets a turn between two signatures. Measured
 * with the project's presigner: 1000 signatures take 164 ms with zero loop turns, during which
 * no other request is served. A library page signs two per media; at `pageSize=500` (reachable
 * with a plain URL parameter) that is 1000 signatures in one block. Hence a real loop turn
 * every 25 lines.
 */
const SIGN_YIELD_EVERY = 25;

/** Yields to the event loop: `setImmediate` is the only point that lets pending I/O through. */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * `Promise.all(rows.map(build))`, but in slices, with an event-loop turn between each.
 *
 * The result is strictly identical: same rows, same order, same values. Only concurrency
 * changes (25 builds at a time instead of all of them). Total CPU cost is unchanged; what
 * disappears is the head-of-line blocking for the other callers of the process.
 */
async function mapYieldingToEventLoop<T, R>(rows: readonly T[], build: (row: T) => Promise<R>): Promise<R[]> {
  if (rows.length <= SIGN_YIELD_EVERY) return Promise.all(rows.map(build));
  const out: R[] = [];
  for (let i = 0; i < rows.length; i += SIGN_YIELD_EVERY) {
    if (i > 0) await yieldToEventLoop();
    out.push(...(await Promise.all(rows.slice(i, i + SIGN_YIELD_EVERY).map(build))));
  }
  return out;
}

/** Paginated library: published media (READY) of a project, with presigned URLs. */
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
  const items = await mapYieldingToEventLoop(media, async (m) => ({
    id: m.id,
    kind: m.kind,
    originalName: m.originalName,
    thumbnailUrl: m.thumbnailKey ? await storage.getPresignedGetUrl(m.thumbnailKey) : null,
    // Displayable key: an EXR library would otherwise return URLs that nothing can render.
    url: await storage.getPresignedGetUrl(mediaViewKey(m)),
  }));
  return paginate(items, total, p);
}

export interface ReviewsFilter {
  projectId?: number;
  kind?: MediaKind;
  status?: 'published' | 'draft';
  /** Filter by current review decision: a ReviewStatus id, or 'none' for no decision. */
  decision?: number | 'none';
  /** 'me' = versions whose review was assigned to me (Phase 49); the assignment panel uses it. */
  assigned?: 'me';
}

/**
 * Global "Reviews" page (12.C): published media (READY) of all my projects plus my own
 * drafts, across projects by membership (ADMIN/SUPERVISOR see everything), filterable by
 * project, type and status, sorted newest first.
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
  // Visibility: drafts are only shown to their uploader (same semantics as getDetail).
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
      // Reviews assigned to me (Phase 49). The filter applies to the version, not the media:
      // it is the delivery that is assigned, and it often contains several.
      ...(filter.assigned === 'me' ? { reviewers: { some: { reviewerId: user.id } } } : {}),
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
  const items = await mapYieldingToEventLoop(media, async (m) => {
    const t = m.version?.task;
    const location = t?.shot
      ? `${t.shot.sequence ? t.shot.sequence.code + ' · ' : ''}${t.shot.code} › ${t.name}`
      : t?.asset
        ? `${t.asset.name} › ${t.name}`
        : (m.version?.asset?.name ?? '');
    const project = t?.shot?.project ?? t?.asset?.project ?? m.version?.asset?.project ?? null;
    // Thumbnail sprite for the hover preview of the cards (42.A, #78, video).
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
      // The decision is set on the VERSION, not the media: without this identifier the Reviews
      // page could not change anything in bulk without one call per card.
      versionId: m.versionId,
      versionName: m.version?.name ?? '',
      reviewStatus: m.version?.reviewStatus ?? null,
      project,
      uploader: m.uploader?.name ?? null,
    };
  });
  return paginate(items, total, p);
}

/**
 * The user's drafts (unpublished), with a readable location.
 *
 * Each row also carries its project and the brief rule that applies to it: the "pending
 * drafts" badge is the second place from which one publishes, and publishing means saying
 * to whom it is delegated. Without these two fields the panel would need one call per draft
 * to know whether it can offer the action and under which constraint.
 */
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
              shot: { select: { code: true, projectId: true, sequence: { select: { code: true } } } },
              asset: { select: { name: true, projectId: true } },
            },
          },
          asset: { select: { name: true, projectId: true } },
        },
      },
    },
  });
  // Brief rules are read once per PROJECT, not once per draft: a hundred drafts from the same
  // production must not trigger a hundred settings resolutions, each going through the studio
  // defaults.
  const projectOf = (m: (typeof drafts)[number]) =>
    m.version?.task?.shot?.projectId ?? m.version?.task?.asset?.projectId ?? m.version?.asset?.projectId;
  const rules = new Map(
    await Promise.all(
      [...new Set(drafts.map(projectOf).filter((id): id is number => typeof id === 'number'))].map(
        async (id) => [id, (await resolveProjectSettingsById(id)).reviewRequest] as const,
      ),
    ),
  );
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
      // What is needed to assign the review without leaving the badge: the version, its project,
      // and what that project requires of a brief.
      versionId: m.versionId,
      projectId: projectOf(m) ?? null,
      reviewRequest: rules.get(projectOf(m) ?? -1) ?? null,
    };
  });
}

/**
 * Aligns a version's published state with that of its media (rules in `lib/publishState`).
 *
 * Called after each media publication. Never unpublishes: withdrawing a version from
 * distribution remains a supervisor decision, not a side effect of a deletion.
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

/**
 * Publishes a draft media (reserved to the uploader): the gesture of draft mode.
 *
 * Outside draft mode (the default since Phase 50) the media already arrives published. The
 * route still serves studios that kept drafts, and API v1, whose finalize goes through it. It
 * then republishes nothing; see the guard below.
 *
 * `reviewers` is the gesture of the upload: "publish, and here is who must look at what". The
 * list is written on the VERSION (it is what gets assigned), BEFORE the switch: that gives
 * meaning to the project setting "mandatory brief", which then refuses publication instead of
 * letting it go out and complaining afterwards. When absent, the list already set is left as is:
 * publishing does not undo what was assigned.
 *
 * Returns the media AND the list, so the screen can update without re-reading the media; that
 * re-read would re-sign all its URLs and reload the viewer.
 */
export async function publish(user: SessionUser, id: number, reviewers?: ReviewerInput[]) {
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Media not found');
  // Strictly private draft: only the uploader sees and publishes their media (404 otherwise).
  if (media.uploaderId !== user.id) throw notFound('Media not found');
  // A media still UPLOADING has never gone through `finalize`: no magic-byte validation, no
  // content-type normalization, no antivirus, no check of the real size against quotas.
  // Publishing it would serve unverified content.
  if (media.status === MediaStatus.UPLOADING) throw badRequest('Upload not finalised', 'NOT_FINALIZED');
  if (reviewers !== undefined) {
    // An explicitly requested list is not lost silently: a version detached from any project
    // has nobody to assign it to, and saying so is better than publishing as if nothing happened.
    const owner = await resolveProjectIdForVersion(media.versionId);
    if (!owner) throw notFound('Version not attached to a project');
    await setReviewers(user, owner, media.versionId, reviewers);
  }
  // A media already published (which is every upload outside draft mode) is not republished:
  // the requested list is written and we stop there. Without this guard the API v1 path
  // (`PublishFlowService.complete`) would announce the same delivery twice: two webhooks, two
  // follower notifications, two ShotGrid sends.
  const alreadyPublished = media.published;
  const updated = alreadyPublished
    ? media
    : await prisma.mediaObject.update({ where: { id }, data: { published: true } });
  if (!alreadyPublished)
    await announcePublication(updated, await resolveProjectIdForVersion(media.versionId), user.id);
  return { media: serializeMedia(updated), reviewers: await listReviewers(media.versionId) };
}

/**
 * What follows a media publication, wherever it comes from.
 *
 * Extracted from `publish` because there are now TWO doors: the explicit gesture in draft
 * mode, and the upload finalization, which publishes automatically. Leaving the second one
 * without these effects would give media visible to everyone while the version stays "draft",
 * with followers never hearing about it and ShotGrid never receiving it.
 *
 * `projectId` may be missing (detached version): the version still follows its media, but
 * there is nobody to notify.
 */
export async function announcePublication(
  media: { id: number; versionId: number; kind: MediaKind; originalName: string },
  projectId: number | null,
  actorId: number,
): Promise<void> {
  const { id, versionId, originalName } = media;
  // The version follows its media: as soon as no draft remains, it is published.
  await syncVersionPublication(versionId, actorId);
  if (!projectId) return;
  emitToProject(projectId, 'media:update', { projectId, id, versionId });
  // 48: the version is sent to ShotGrid: created if unknown there, otherwise the media is added
  // to the existing version. A media added along the way must not create a duplicate with the
  // same name.
  await enqueuePush(projectId, { type: 'version-publish', versionId, actorId });
  // Followers (32.G): publication on the version/shot/asset chain.
  await notifyWatchers({
    mediaObjectId: id,
    projectId,
    messageKey: 'notification.mediaPublished',
    params: { name: originalName },
    exclude: [actorId],
  });
  // Outgoing webhooks (36.D).
  publishApiEvent('media.published', {
    projectId,
    entityType: 'media',
    entityId: id,
    actorId,
    payload: {
      mediaObjectId: id,
      versionId,
      projectId,
      kind: media.kind,
      originalName,
      publishedBy: actorId,
    },
  });
  // Team messaging (42.B, #67).
  void notifyChat('chat.mediaPublished', { name: originalName });
}

/**
 * Re-queues a media's processing job.
 *
 * A draft can be re-queued freely. A **published** media can only be re-queued if its
 * processing failed, and only once (`lib/publishLock`): without this exception, a media
 * published automatically whose transcoding fails would be dead forever, since the lock
 * forbade re-queuing and no draft was left to start over. The consumed retry is counted in
 * `metadata`, so a second attempt is refused with its own wording rather than a generic
 * "locked" message.
 */
export async function reprocess(user: SessionUser, id: number) {
  await assertMediaManage(id, user);
  /*
   * Read, check and spend the counter UNDER ROW LOCK (CP-SEC of phase 50).
   *
   * With separate read-then-write, two simultaneous POSTs on the same failed published media
   * both read 0, both wrote 1 and both enqueued a job: "one retry" became "as many as can run
   * in parallel". The same window also lost a concurrent worker write to `metadata`, since the
   * counter rewrote the whole JSON column from a stale read.
   *
   * `FOR UPDATE` is enough here (no need for serializable): both queries target the same row,
   * the second waits for the first and re-reads its already-spent counter.
   */
  const media = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MediaObject" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.mediaObject.findUnique({ where: { id } });
    if (!row) throw notFound('Media not found');
    if (row.status === MediaStatus.UPLOADING) throw badRequest('Upload not finalised', 'NOT_FINALIZED');
    assertReprocessable(row);
    // The counter is only kept for a published media: a draft can be re-queued without limit,
    // and giving it a counter would fail its first re-queue after publication.
    if (row.published) {
      await tx.mediaObject.update({
        where: { id },
        data: { metadata: withPublishedReprocess(row.metadata) as Prisma.InputJsonObject },
      });
    }
    return row;
  });
  // The counter is already spent in the transaction above: the writes that follow only carry
  // the status.
  const spend = {};

  const ext = getExtension(media.originalName);
  const jobKind = jobKindFor(media.kind, ext);
  if (!jobKind) {
    // Nothing to reconvert (e.g. native GLB/glTF): simply set it back to READY.
    const updated = await prisma.mediaObject.update({
      where: { id },
      data: { status: MediaStatus.READY, ...spend },
    });
    await requestSpatialThumb(id, media.kind, ext);
    return { media: serializeMedia(updated), requeued: false };
  }

  const updated = await prisma.mediaObject.update({
    where: { id },
    data: { status: MediaStatus.PROCESSING, ...spend },
  });
  await enqueueMediaJob({ mediaObjectId: id, kind: jobKind });
  await requestSpatialThumb(id, media.kind, ext);
  logAudit({ userId: user.id, action: 'MEDIA_REPROCESS', entityType: 'MediaObject', entityId: id });
  return { media: serializeMedia(updated), requeued: true };
}

/**
 * "Source" key actually served for a media: after video transcoding the original is deleted
 * (space saving) and the MP4 proxy becomes the source.
 */
export function mediaSourceKey(media: { storageKey: string; metadata: unknown }): string {
  const meta = (media.metadata ?? {}) as { proxyKey?: string; sourceDeleted?: boolean };
  return meta.sourceDeleted && meta.proxyKey ? meta.proxyKey : media.storageKey;
}

/**
 * Key actually **displayable** for a media: the web proxy when the original format is not
 * rendered by browsers (EXR, DPX, TIFF, TGA; see `lib/imageProxy`), the source otherwise.
 *
 * The distinction from `mediaSourceKey` is the cornerstone of production image review: the
 * viewer, A/B, wipe and diff consume this key, while download, API v1 and ShotGrid sends keep
 * delivering the original, which is the file the artist deposited.
 */
export function mediaViewKey(media: { storageKey: string; metadata: unknown }): string {
  const meta = (media.metadata ?? {}) as { webProxyKey?: string };
  return typeof meta.webProxyKey === 'string' && meta.webProxyKey.length > 0
    ? meta.webProxyKey
    : mediaSourceKey(media);
}

/** Full media detail + presigned URLs (original, thumbnail, proxy, glb). */
export async function getDetail(user: SessionUser, id: number, ip?: string | null) {
  const media = await prisma.mediaObject.findUnique({ where: { id } });
  if (!media) throw notFound('Media not found');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Media not found');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
  // Access log (36.E): the review loads this detail on open; deduplicated over 30 min.
  logMediaAccess({ mediaObjectId: id, userId: user.id, ip: ip ?? null });
  const meta = (media.metadata ?? {}) as {
    proxyKey?: string;
    sourceDeleted?: boolean;
    glbKey?: string;
    // `usd` (45.C): scene description: root layer, variants, missing assets.
    model?: { sourceFormat: string; converter: string; native: boolean; usd?: unknown };
    // Reason for a processing failure (45.C), shown in review rather than a silent `FAILED`.
    processingError?: string;
    /** Name of the file actually delivered by ShotGrid, when the media carries the site code. */
    sourceFilename?: string;
    /** Brief written at upload (Phase 50): what the author says about what they deliver. */
    uploadNote?: string;
    // Scene override (46.D): staging replayed on open, for everyone.
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
  // Compatibility of historical cuts (Phase 50, batch 4): video trimming was removed and nothing
  // produces `trimProxyKey` any more. Reading is kept: a media cut before the removal keeps
  // playing its cut. Removing this would suddenly replay the uncut version of a media already
  // validated and commented by others.
  const proxyKey = meta.trim && meta.trimProxyKey ? meta.trimProxyKey : meta.proxyKey;
  const sourceKey = mediaSourceKey(media);
  // Production image (EXR, DPX, TIFF, TGA): the viewer receives the web proxy, never the
  // original, which the browser would not decode. Both are returned: one to watch, the other
  // to download.
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
    deliveryAspect,
    references,
    reviewers,
    version,
    manager,
  ] = await Promise.all([
    storage.getPresignedGetUrl(viewKey),
    media.thumbnailKey ? storage.getPresignedGetUrl(media.thumbnailKey) : Promise.resolve(null),
    proxyKey ? storage.getPresignedGetUrl(proxyKey) : Promise.resolve(null),
    meta.glbKey ? storage.getPresignedGetUrl(meta.glbKey) : Promise.resolve(null),
    meta.splatMaskKey ? storage.getPresignedGetUrl(meta.splatMaskKey) : Promise.resolve(null),
    meta.splatSubsetKey ? storage.getPresignedGetUrl(meta.splatSubsetKey) : Promise.resolve(null),
    meta.timelineSprite?.key ? storage.getPresignedGetUrl(meta.timelineSprite.key) : Promise.resolve(null),
    prisma.project.findUnique({ where: { id: projectId }, select: { startFrame: true } }),
    // Project default HDRI lighting (39.F): replayed if the media has none of its own.
    resolveProjectSettingsById(projectId),
    // Delivery frame ratio (Phase 50, batch 8): pipeline setting inherited
    // studio -> project -> sequence -> shot, like an image sequence's frame rate.
    resolveDeliveryAspect(media.versionId, projectId),
    // Reference images (Phase 24, multi-items): inline read (the service imports
    // assertMediaManage from here, and a cross import would create a cycle).
    prisma.reviewReference.findMany({ where: { mediaObjectId: id }, orderBy: { id: 'asc' } }).then((rows) =>
      Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          url: await storage.getPresignedGetUrl(r.storageKey),
          x: r.x,
          y: r.y,
          width: r.width,
          // Carrying comment: only shown when selected (null = historical).
          commentId: r.commentId,
        })),
      ),
    ),
    // Who is expected on this version, and their brief. The read guard is the function's own:
    // we only get here after passing it.
    listReviewers(media.versionId),
    // Write rights returned with the media (`permissions`): the version author and its
    // publication state are the two inputs of the predicate, the effective role on the project
    // the third. Without them the screen guessed, and offered a button that ended in a 403
    // (see `lib/versionPermissions`).
    prisma.version.findUnique({
      where: { id: media.versionId },
      select: { authorId: true, published: true },
    }),
    isProjectManager(user.id, user.role, projectId),
  ]);
  return {
    media: serializeMedia(media),
    // Carrying project: avoids a separate resolution on the front end (mentions, deep links).
    projectId,
    url,
    // File as it was deposited: identical to `url` except for a production image, where `url`
    // is the JPEG proxy. This is the address "download" must follow.
    downloadUrl: viewKey === sourceKey ? url : await storage.getPresignedGetUrl(sourceKey),
    // Is the media served by a derivative rather than its original file? (For display of an
    // EXR/DPX/TIFF/TGA, what is on screen is not the reference file.)
    webProxy: viewKey !== sourceKey,
    thumbnailUrl,
    proxyUrl,
    glbUrl,
    startFrame: project?.startFrame ?? 1001,
    // 3D conversion provenance (39.A, extended in 45.C with the `usd` block): technical sheet.
    modelSource: meta.model ?? null,
    // The imported media carries the ShotGrid Version code; the delivered file name stays
    // readable here, since a studio's naming convention often encodes information (colour
    // space, encoding) that the code does not repeat.
    sourceFilename: meta.sourceFilename ?? null,
    // Failure reason when the media is FAILED (45.C): missing USD asset, missing tooling...
    processingError: meta.processingError ?? null,
    // Upload brief (Phase 50): what the author said when delivering. Shown to everyone: it
    // answers "what is expected of me?" when nobody is assigned.
    uploadNote: meta.uploadNote ?? null,
    // Scene override (46.D): replayed when the 3D viewer loads, for all viewers.
    usdOverride: meta.usdOverride ?? null,
    fps: meta.fps ?? null,
    // Live room broadcast frequency (33.B), admin-settable per media type.
    liveSyncHz: await getLiveSyncHz(media.kind),
    // Non-destructive splat edits (10.G): JSON + binary mask (SplatEditService).
    splatEdits: meta.splatEdits ?? null,
    splatMaskUrl,
    splatMaskCount: meta.splatMaskCount ?? 0,
    // Subset transformations (Phase 28): binary ops replayed on load.
    splatSubsetUrl,
    splatSubsetCount: meta.splatSubsetCount ?? 0,
    // Persisted presentation (10.G-V5): camera/DoF/reveal/LOD/animation, replayed for everyone.
    splatPresentation: meta.splatPresentation ?? null,
    // Project default HDRI lighting (39.F): fallback when the media has none of its own.
    projectDefaultLighting: projectSettings.defaultLighting ?? null,
    // Project OCIO colour management (39.B): display/view intent (review badge).
    projectColor: projectSettings.color ?? null,
    // Review frame ratio of spatial media: that of the inherited delivery resolution. It does
    // NOT replace the aspect already frozen in a presentation: changing the frame of an
    // already-annotated media would shift annotations already validated.
    deliveryAspect,
    // Historical cut (10.G-V10, removed in Phase 50): bounds of a media cut before the removal.
    // Nothing sets them any more; review uses them to say what it plays.
    trim: meta.trim ?? null,
    trimProxyReady: Boolean(meta.trim && meta.trimProxyKey),
    // Adaptive HLS (Phase 23): when present, the master is served via /api/media/:id/hls/master.m3u8.
    hls: meta.hls ?? null,
    // Timeline thumbnail sprite (one thumbnail about every 3 s, a single JPEG).
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
    // Reference images of 2D review (Phase 24, multi-items): persisted and shared.
    references,
    // Who the review of this version is assigned to, and what each must look at.
    // Returned to everyone: knowing a lead is expected avoids two parallel reviews.
    reviewers,
    // The project rule, returned with the media: the screen can refuse a brief that is too
    // short without a round trip, and say what it expects.
    reviewRequest: projectSettings.reviewRequest,
    // What THIS caller is allowed to write. The 3D viewer uses it so as not to offer a "Clean"
    // mode whose "Save" button would be refused: the rule is that of the write service, not a
    // role approximation copied to the screen.
    permissions: {
      editTransform: version
        ? canEditVersionTransform(version, user.id, manager)
        : /* version disappeared between the two reads: nothing is editable */ false,
    },
  };
}

/**
 * Presigned GET URL for direct serving from MinIO.
 *
 * Serves the **displayable** key: an EXR previously got a presigned URL on the source file,
 * which the browser cannot decode, so the review showed an empty frame. `original: true`
 * requests the deposited file (download, tooling).
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
 * ── HLS delivery (Phase 23, revised in wave 2: video no longer goes through Node) ────────────
 *
 * Before: each 2 s segment went back through the web process after three Prisma access-control
 * queries and was sent with `private, max-age=60`, even though the content is immutable. A
 * ten-minute shot cost ~300 requests per rendition and per viewer, all charged to the shared
 * per-IP rate limit, which is what capped the dailies.
 *
 * Now there are three levels:
 *  1. `master.m3u8`: the database authorization is paid **here, once** (with the access log).
 *     The returned master attaches a read token to each rendition.
 *  2. `<rendition>.m3u8?pt=...`: the token stands in for authorization: HMAC check, zero SQL
 *     queries. The returned sub-playlist points to presigned MinIO URLs.
 *  3. segments: served directly by storage. No video bytes go through Node.
 *
 * The historical proxy `/api/media/:id/hls/<segment>.ts` is still served (clients without a
 * rewritten manifest, unexpected segment names): nothing breaks, but it is no longer the nominal
 * path, and it now sets an immutable cache.
 */

/** Response for an HLS file: a text body (rewritten playlist) or a stream (segment fallback). */
export interface HlsFileResponse {
  contentType: string;
  cacheControl: string;
  body?: string;
  stream?: Readable;
}

/** A segment never changes: once fetched, it never needs to be requested again. */
const HLS_SEGMENT_CACHE_CONTROL = 'private, max-age=31536000, immutable';
/** Playlists carry a token and signed URLs: never a shared cache. */
const HLS_PLAYLIST_CACHE_CONTROL = 'private, no-store';

const hlsKey = (id: number, file: string) => `derived/${id}/hls/${file}`;

/** The full access check: the three queries that the read token avoids afterwards. */
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
 * Rewritten sub-playlists, **frozen per signature window**.
 *
 * Otherwise two viewers would receive two different sets of presigned URLs for the same
 * segments (the signature depends on the instant), and no shared cache could match them.
 * By freezing the playlist per fifteen-minute window, the twenty viewers of a daily request
 * exactly the same URLs, so the front end reads each segment from storage only once. Accepted
 * corollary: a regenerated HLS ladder (reprocess) may be announced with at most one window of delay.
 */
interface RenditionEntry {
  /** Size of the cached text, counted once resolved (0 while the read is in flight). */
  bytes: number;
  text: Promise<string>;
}

const renditionCache = new Map<string, RenditionEntry>();
let renditionCacheBytes = 0;
/** Signature window covered by the cache contents (-1 = empty cache). */
let renditionCacheWindow = -1;

/**
 * Entry cap, sized for a dailies room rather than picked at random.
 *
 * One entry = one rendition of a media. Measured on the dev stack: a transcoded media has 1 to 3
 * renditions (360p/720p/1080p depending on the source). A dailies playlist of fifteen to thirty
 * shots thus consumes 45 to 120 entries within the same signature window. The old cap of 32
 * evicted them continuously, and since eviction was strict FIFO with no refresh on read, a
 * cyclic traversal of the playlist systematically evicted the entry about to be needed: zero hit
 * rate, precisely in the case the cache was meant to serve. 512 covers a 128-shot playlist with
 * 4 renditions.
 */
const RENDITION_CACHE_MAX = 512;

/**
 * Memory cap: the real bound, because an entry's size varies by two orders of magnitude.
 * Measured: a rewritten sub-playlist of a 52 s shot with 2 s segments weighs 11.3 kB (27
 * segments x ~420 B of presigned URL); a ten-minute cut would weigh ~126 kB. Counting entries
 * alone would let the cache weigh anywhere from 6 to 64 MB depending on content. 8 MB compares
 * with the ~2 MB of the signature cache (`PRESIGN_CACHE_MAX`), and it is the cap that bites
 * first on long cuts.
 */
const RENDITION_CACHE_MAX_BYTES = 8 * 1024 * 1024;

/** Reads the sub-playlist and rewrites each segment as a presigned URL. No cache here. */
async function buildPresignedRendition(id: number, file: string): Promise<string> {
  const text = await readHlsText(id, file);
  const names = playlistUris(text).filter(isSafeHlsName);
  const signed = await Promise.all(
    names.map(
      async (name) => [name, await storage.getPresignedGetUrl(hlsKey(id, name), HLS_URL_TTL_SEC)] as const,
    ),
  );
  return withPresignedSegments(text, new Map(signed));
}

/** Evicts the least recently READ entries until back under both caps. */
function evictRenditions(): void {
  while (renditionCache.size > RENDITION_CACHE_MAX || renditionCacheBytes > RENDITION_CACHE_MAX_BYTES) {
    const oldest = renditionCache.entries().next();
    if (oldest.done) break;
    renditionCache.delete(oldest.value[0]);
    renditionCacheBytes -= oldest.value[1].bytes;
  }
}

async function presignedRendition(id: number, file: string): Promise<string> {
  const windowStart = signingWindowStart();
  // The key carries the window: when the window changes, ALL content goes stale at once. A
  // `clear()` is therefore exactly the former key-by-key sweep, in O(1).
  if (windowStart !== renditionCacheWindow) {
    renditionCache.clear();
    renditionCacheBytes = 0;
    renditionCacheWindow = windowStart;
  }
  const cacheKey = `${windowStart}:${id}:${file}`;

  const hit = renditionCache.get(cacheKey);
  if (hit) {
    // LRU: reading refreshes the entry (a Map iterates in insertion order). With strict FIFO,
    // the rendition just served would remain the next to be evicted.
    renditionCache.delete(cacheKey);
    renditionCache.set(cacheKey, hit);
    return hit.text;
  }

  // Memoize the PROMISE, not the text. Without this the cache only matched SEQUENTIAL viewers:
  // the twenty viewers of a daily arrive together, all miss the cache, and each redoes its
  // MinIO read and its signature set.
  const entry: RenditionEntry = { bytes: 0, text: buildPresignedRendition(id, file) };
  renditionCache.set(cacheKey, entry);
  void entry.text.then(
    (text) => {
      if (renditionCache.get(cacheKey) !== entry) return;
      entry.bytes = Buffer.byteLength(text, 'utf8');
      renditionCacheBytes += entry.bytes;
      evictRenditions();
    },
    () => {
      // A failure is not memoized: the next read must be able to retry.
      if (renditionCache.get(cacheKey) === entry) renditionCache.delete(cacheKey);
    },
  );
  return entry.text;
}

/** Empties the sub-playlist cache (tests, and an entry point if a purger needs it). */
export function resetHlsPlaylistCache(): void {
  renditionCache.clear();
  renditionCacheBytes = 0;
  renditionCacheWindow = -1;
}

/** Sub-playlist cache counters: read by tests, never by a route. */
export const __hlsCacheTesting = {
  stats: () => ({ entries: renditionCache.size, bytes: renditionCacheBytes }),
  RENDITION_CACHE_MAX,
  RENDITION_CACHE_MAX_BYTES,
};

/**
 * HLS manifest or segment (`derived/{id}/hls/{file}`). `file` is validated by the route;
 * it is re-validated here because it composes a storage key.
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
  // A valid read token skips the database check; if absent or invalid (expired, other media,
  // other account), the full check is redone: never a surprise refusal.
  if (isMaster || !verifyMediaPlaybackToken(opts.playbackToken, id, user.id)) await assertHlsRead(user, id);

  if (isMaster) {
    // Access log (36.E), deduplicated over a 30 min window: viewing stays traced even though
    // segments no longer go through the API.
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
 * Stores a thumbnail provided by the client (capture of a render or a chosen file).
 * base64 image/jpeg|png|webp data URL, validated by magic bytes, stored in MinIO, referenced
 * by `thumbnailKey`. Reserved to the media's managers (uploader/supervisor+).
 * The thumbnail is **presentation** (like `splatPresentation`): it remains editable after
 * publication, a deliberate exception to the Phase 11 lock (the media content itself stays frozen).
 */
/** Decodes and validates a base64 image data URL into buffer + type + extension (throws if invalid). */
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
 * **Automatic** thumbnail captured client-side at the first viewing of a 3D/splat media (no
 * headless server rendering). Idempotent bootstrap: writes only if `thumbnailKey` is **absent**
 * (it never overwrites, so it does not conflict with the publication lock: a missing preview is
 * filled, the media itself is not modified). Read access is enough (any project member who sees
 * the media). Concurrency is handled by a conditional update (a single write).
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
  // Already has a thumbnail (worker or concurrent capture): leave everything untouched.
  if (media.thumbnailKey) {
    return { thumbnailUrl: await storage.getPresignedGetUrl(media.thumbnailKey), created: false };
  }
  const { buf, contentType, ext } = decodeThumbnailDataUrl(dataUrl);
  const key = StorageService.thumbnailKey(id, ext);
  await storage.putObject(key, buf, contentType);
  // Conditional write: only sets the key if it is still null (race protection).
  const { count } = await prisma.mediaObject.updateMany({
    where: { id, thumbnailKey: null },
    data: { thumbnailKey: key },
  });
  if (count === 0) {
    // A concurrent capture won: delete our object and return theirs.
    await storage.deleteObject(key).catch(() => undefined);
    const fresh = await prisma.mediaObject.findUnique({ where: { id }, select: { thumbnailKey: true } });
    const url = fresh?.thumbnailKey ? await storage.getPresignedGetUrl(fresh.thumbnailKey) : null;
    return { thumbnailUrl: url, created: false };
  }
  return { thumbnailUrl: await storage.getPresignedGetUrl(key), created: true };
}

/** Checks that the user can manage this media (uploader or supervisor+) and returns the project. */
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
  // 38.E: the global role decides nothing here. An ARTIST demoted to CLIENT keeps their
  // membership (so `checkProjectAccess` still says yes) but no longer manages the media they
  // deposited earlier; an ARTIST promoted to SUPERVISOR locally manages the others.
  await assertCanContribute(user.id, user.role, projectId);
  const manager = await isProjectManager(user.id, user.role, projectId);
  if (!manager && media.uploaderId !== user.id)
    throw forbidden("Suppression réservée à l'uploader ou un superviseur");
  return { projectId, versionId: media.versionId };
}

/** Soft-deletes (trashes) a media. */
export async function trash(user: SessionUser, id: number) {
  const { projectId, versionId } = await assertMediaManage(id, user);
  await softDeleteMedia(id);
  logAudit({ userId: user.id, action: 'MEDIA_DELETE', entityType: 'MediaObject', entityId: id });
  emitToProject(projectId, 'media:update', { projectId, id, versionId });
}

/** Restores a media from the trash. */
export async function restore(user: SessionUser, id: number) {
  const { projectId, versionId } = await assertMediaManage(id, user);
  await restoreMedia(id);
  emitToProject(projectId, 'media:update', { projectId, id, versionId });
}

/** Permanently purges a media (supervisor+). */
export async function purge(user: SessionUser, id: number) {
  if (user.role !== Role.ADMIN && user.role !== Role.SUPERVISOR)
    throw forbidden('Supervisors and administrators only');
  const { projectId, versionId } = await assertMediaManage(id, user);
  await purgeMedia(id);
  logAudit({ userId: user.id, action: 'MEDIA_PURGE', entityType: 'MediaObject', entityId: id });
  emitToProject(projectId, 'media:update', { projectId, id, versionId });
}
