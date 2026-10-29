// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { checkProjectAccess } from '../middleware/rbac';
import { storage, StorageService } from '../lib/storage';
import { validateMediaHeader, getExtension } from '../lib/fileSignatures';
import { resolveProjectIdForVersion, resolveStorageContextForVersion } from '../lib/pipeline';
import { checkNaming, resolveProjectSettingsById } from '../lib/projectSettings';
import { resolveDeliveryAspect } from '../lib/deliveryAspect';
import { assertUploadNote } from '../lib/uploadNote';
import { slugifyFilename } from '../lib/slug';
import { logAudit } from './AuditService';
import { enqueueMediaJob, enqueueSpatialThumb } from '../lib/queues';
import { jobKindFor, spatialThumbSource } from '../lib/mediaJobKind';
import { getLiveSyncHz, getNumericSetting, isDraftModeEnabled, SETTING_KEYS } from '../lib/settings';
import { logMediaAccess } from '../lib/mediaAccess';
import { isClamavEnabled } from '../lib/clamav';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors';
import { assertReprocessable, assertWritable, withPublishedReprocess } from '../lib/publishLock';
import { canEditVersionTransform } from '../lib/versionPermissions';
import { bornsPublished } from '../lib/publishState';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertProjectQuota } from '../lib/projectQuota';
import { logger } from '../lib/logger';
import { assertCanContribute, isProjectManager } from '../lib/projectRoles';
import { listReviewers } from './ReviewAssignmentService';
import type { UsdRequest } from './ModelConvertService';
import { ignoreFailure } from '../lib/ignoreFailure';
import { serializeMedia, mediaSourceKey, mediaViewKey, type SessionUser } from './mediaShared';
import { announcePublication } from './MediaPublicationService';
import { assertMediaManage } from './MediaManageService';

// The media services are split by concern; this module keeps upload, finalize, reprocess and detail, and
// re-exports the rest so that `import * as MediaService` callers see one surface.
export * from './MediaListService';
export * from './MediaPublicationService';
export * from './MediaHlsService';
export * from './MediaManageService';
export { mediaSourceKey, mediaViewKey } from './mediaShared';

/**
 * Media business logic: presigned upload, finalize with magic-byte validation,
 * publication, reprocess, library and trash. Routes only validate, call these
 * functions, then respond.
 */

/**
 * Requests the thumbnail of a spatial media (3D/splat). Runs on a dedicated
 * queue and never blocks: Redis being down must not fail an upload finalize.
 */
async function requestSpatialThumb(mediaId: number, kind: MediaKind, ext: string): Promise<void> {
  if (!spatialThumbSource(kind, ext)) return;
  await enqueueSpatialThumb({ mediaObjectId: mediaId }).catch((err: unknown) =>
    logger.warn({ err }, `[Media] spatial thumbnail not queued media=${mediaId}`),
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
  if (active >= maxConcurrent) throw new AppError('Too many simultaneous uploads', 429, 'TOO_MANY_UPLOADS');

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
    await storage
      .deleteObject(media.storageKey)
      .catch(ignoreFailure('rejected upload cleanup failed', { mediaId: id }));
    throw badRequest('Invalid file type (magic-bytes check failed)', 'INVALID_FILE');
  }

  // REAL size of the deposited object. Quotas were only checked when the URL was requested,
  // against a *declared* size: announcing 1 byte then uploading 50 GB passed unnoticed.
  const realSize = stat.size;
  const maxFileSize = await getNumericSetting(SETTING_KEYS.MAX_FILE_SIZE);
  if (realSize > maxFileSize) {
    await prisma.mediaObject.update({ where: { id }, data: { status: MediaStatus.FAILED } });
    await storage
      .deleteObject(media.storageKey)
      .catch(ignoreFailure('rejected upload cleanup failed', { mediaId: id }));
    throw badRequest('File is too large', 'FILE_TOO_LARGE');
  }
  try {
    await assertProjectQuota(projectId, realSize);
  } catch (err) {
    await prisma.mediaObject.update({ where: { id }, data: { status: MediaStatus.FAILED } });
    await storage
      .deleteObject(media.storageKey)
      .catch(ignoreFailure('rejected upload cleanup failed', { mediaId: id }));
    throw err;
  }

  // The stored type is fixed here, server-side: the one passed to the PUT signature is not
  // binding (the presigner only signs `host`), so the browser could have stored `text/html`.
  // Objects are served from the app origin, so reset it to an inert value before the media
  // becomes readable.
  await storage
    .setObjectContentType(media.storageKey, stat.contentType ?? '')
    .catch((err) => logger.warn({ err, key: media.storageKey }, '[Media] content type not normalized'));

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
