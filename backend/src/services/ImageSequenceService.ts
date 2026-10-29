// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus, Prisma, type Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { announcePublication, createUpload } from './MediaService';
import { logAudit } from './AuditService';
import { enqueueMediaJob } from './JobService';
import { badRequest, notFound } from '../lib/errors';
import { checkProjectAccess } from '../middleware/rbac';
import { validateMediaHeader } from '../lib/fileSignatures';
import { OPAQUE_CONTENT_TYPE } from '../lib/uploadContentType';
import { resolveEntitySettings, resolveProjectSettingsById } from '../lib/projectSettings';
import { assertProjectQuota } from '../lib/projectQuota';
import { assertUploadNote } from '../lib/uploadNote';
import { getNumericSetting, isDraftModeEnabled, SETTING_KEYS } from '../lib/settings';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import {
  isSafeFrameName,
  MAX_SEQUENCE_FRAMES,
  MIN_SEQUENCE_FRAMES,
  parseFrameName,
  parseFramePattern,
  sequenceFrameKey,
  sequenceFramePrefix,
  sequenceManifestKey,
  sequenceSummary,
  type SequenceManifest,
} from '../lib/imageSequence';

/**
 * Transport of an image sequence: N files, ONE media.
 *
 * Resumable multipart (`MediaUploadService`) splits **one** file into parts; here it is the reverse — a
 * thousand whole files must form a single media. Parallelism, resume and
 * cancellation are therefore replayed at the scale of the frame:
 *
 * 1. `initSequence` — creates the carrier media (VIDEO, UPLOADING) and the `ImageSequence` row, or **finds**
 * that of an interrupted upload. The frames already deposited are
 *      listed from MinIO: storage is authoritative, the client has no state to keep.
 *   2. `frameUploadUrls` — presigned URLs in batches; the client sends several in parallel.
 * 3. `completeSequence` — verifies what actually arrived, writes the manifest, and enqueues the assembly.
 * This is where the role of `MediaService.finalize` is played, which
 *      can only validate a single object.
 *   4. `listSequenceFrames` — the original deliverable, frame by frame, as presigned URLs.
 */

type SessionUser = { id: number; role: Role };

/** Presigned URLs requested at once: bounds the signing cost of one round trip. */
export const FRAME_URL_BATCH_MAX = 64;

/**
 * Lifetime of the download URLs of the original deliverable.
 *
 * Fetching a thousand 50 MB EXRs takes time, even over four connections: one hour is not always enough, and
 * the whole list would have to be requested again midway.
 */
const FRAME_URL_TTL_SEC = 6 * 3600;

/**
 * Frames whose header is actually re-read at finalization.
 *
 * Re-reading the first 32 bytes of three thousand objects would cost three thousand requests for a guarantee
 * that the listing already gives in one: every frame exists and is not
 * empty. We therefore re-read the first, the middle and the last — enough to catch the real case (a folder of
 * PNGs deposited under an `.exr` extension, a delivery truncated at its
 * head or tail), without turning finalization into a full sweep of the bucket.
 */
const HEADER_CHECK_POSITIONS = 3;

export interface InitSequenceInput {
  versionId: number;
  /** FFmpeg pattern (`SH0100_comp_v003.%04d.exr`) — this is the name of the media. */
  pattern: string;
  /** Files of the batch: delivered name and announced size. */
  frames: { name: string; size: number }[];
  /** Frame rate imposed by the user; otherwise inherited from the shot's pipeline. */
  framerate?: number;
}

/** Resume metadata: distinguishes a sequence in progress from a multipart upload. */
interface SequenceMeta {
  sequencePending?: boolean;
  [key: string]: unknown;
}

/**
 * Assembly frame rate: inherited studio → project → sequence → shot, exactly what administration displays. An
 * image sequence has no intrinsic frame rate — inventing one for it (24 hard-coded) would produce a shot that
 * does not last what it should.
 */
export async function resolveSequenceFramerate(versionId: number, projectId: number): Promise<number> {
  const project = await resolveProjectSettingsById(projectId);
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: {
      task: { select: { shot: { select: { settings: true, sequence: { select: { settings: true } } } } } },
    },
  });
  const shot = version?.task?.shot ?? null;
  return resolveEntitySettings(project, shot?.sequence?.settings, shot?.settings).framerate;
}

/** Shape checks of the batch, before any write: refuse early, never after the transfer. */
function assertSequenceShape(input: InitSequenceInput): { extension: string; digits: number } {
  const parsed = parseFramePattern(input.pattern);
  if (!parsed) throw badRequest('Not an image sequence pattern (expected « name.%04d.ext »)', 'BAD_PATTERN');
  if (input.frames.length < MIN_SEQUENCE_FRAMES)
    throw badRequest('An image sequence needs at least two frames', 'SEQUENCE_TOO_SHORT');
  if (input.frames.length > MAX_SEQUENCE_FRAMES)
    throw badRequest(
      `An image sequence is capped at ${String(MAX_SEQUENCE_FRAMES)} frames`,
      'SEQUENCE_TOO_LONG',
    );

  const seen = new Set<string>();
  for (const frame of input.frames) {
    if (!isSafeFrameName(frame.name))
      throw badRequest(`Frame name rejected: « ${frame.name} »`, 'BAD_FRAME_NAME');
    if (seen.has(frame.name)) throw badRequest(`Frame sent twice: « ${frame.name} »`, 'DUPLICATE_FRAME');
    seen.add(frame.name);
    const named = parseFrameName(frame.name);
    if (!named || named.extension !== parsed.extension || named.digits !== parsed.digits)
      throw badRequest(`« ${frame.name} » does not match ${input.pattern}`, 'FRAME_OUTSIDE_PATTERN');
  }
  return parsed;
}

/** Frame numbers of the batch, in order, paired with their file name. */
function orderedFrames(input: InitSequenceInput): { frame: number; name: string; size: number }[] {
  return input.frames
    .map((f) => ({ frame: parseFrameName(f.name)!.number, name: f.name, size: f.size }))
    .sort((a, b) => a.frame - b.frame);
}

/**
 * Opens (or resumes) the upload of a sequence.
 *
 * Resumption relies on nothing the client might hold: same version, same account, same pattern, UPLOADING
 * status — and the list of frames already in place is re-read from MinIO.
 * Closing the tab in the middle of an 80 GB delivery therefore only costs the frames in flight.
 */
export async function initSequence(user: SessionUser, input: InitSequenceInput) {
  const { extension, digits } = assertSequenceShape(input);
  const frames = orderedFrames(input);
  const summary = sequenceSummary(frames.map((f) => f.frame));
  const declaredSize = frames.reduce((acc, f) => acc + Math.max(0, f.size), 0);

  const pending = await prisma.mediaObject.findFirst({
    where: {
      uploaderId: user.id,
      versionId: input.versionId,
      originalName: input.pattern,
      status: MediaStatus.UPLOADING,
      imageSequence: { isNot: null },
    },
    include: { imageSequence: true },
    orderBy: { id: 'desc' },
  });
  if (pending?.imageSequence) {
    return {
      mediaObjectId: pending.id,
      resumed: true,
      framerate: pending.imageSequence.framerate,
      uploadedFrames: await listUploadedFrameNames(pending.imageSequence.storagePrefix),
      namingWarning: false,
    };
  }

  // A 2 GB frame does not exist: the file size ceiling applies to the whole batch, otherwise the studio's
  // limit could be bypassed by splitting it.
  const maxFileSize = await getNumericSetting(SETTING_KEYS.MAX_FILE_SIZE);
  if (declaredSize > maxFileSize) throw badRequest('Image sequence is too large', 'FILE_TOO_LARGE');

  // All the safeguards of an ordinary upload (access, contribution, archived project, quotas, naming
  // convention, publication inheritance) are those of `createUpload`: we call it rather
  // than write a second version, which would have drifted. The presigned URL it returns is not used here — a
  // sequence has no single object to deposit.
  const created = await createUpload(user, {
    versionId: input.versionId,
    filename: input.pattern,
    contentType: 'application/json',
    kind: MediaKind.VIDEO,
    size: declaredSize,
  });

  const projectId = await resolveProjectIdForVersion(input.versionId);
  const framerate =
    input.framerate ?? (projectId ? await resolveSequenceFramerate(input.versionId, projectId) : 24);
  const manifestKey = sequenceManifestKey(created.storageKey);
  const storagePrefix = sequenceFramePrefix(created.storageKey);

  await prisma.$transaction([
    prisma.mediaObject.update({
      where: { id: created.mediaObjectId },
      data: { storageKey: manifestKey, metadata: { sequencePending: true } },
    }),
    prisma.imageSequence.create({
      data: {
        mediaObjectId: created.mediaObjectId,
        pattern: input.pattern,
        extension,
        digits,
        startFrame: summary.startFrame,
        endFrame: summary.endFrame,
        frameCount: summary.frameCount,
        framerate,
        storagePrefix,
      },
    }),
  ]);

  return {
    mediaObjectId: created.mediaObjectId,
    resumed: false,
    framerate,
    uploadedFrames: [] as string[],
    namingWarning: created.namingWarning ?? false,
  };
}

/** Frames already present under the prefix (storage is authoritative, as ListParts is in multipart). */
async function listUploadedFrameNames(prefix: string): Promise<string[]> {
  const names: string[] = [];
  for await (const object of storage.iterateObjects(prefix)) {
    if (object.size > 0) names.push(object.key.slice(prefix.length));
  }
  return names.sort((a, b) => a.localeCompare(b));
}

/** Loads a sequence being uploaded that belongs to the caller. */
async function loadOwnSequence(user: SessionUser, id: number, status: MediaStatus) {
  const media = await prisma.mediaObject.findFirst({
    where: { id, uploaderId: user.id, status },
    include: { imageSequence: true },
  });
  if (!media?.imageSequence) throw notFound('Image sequence upload not found');
  return { media, sequence: media.imageSequence };
}

/** Presigned URLs of a batch of frames. The names are re-validated: they compose a key. */
export async function frameUploadUrls(user: SessionUser, id: number, names: string[]) {
  const { sequence } = await loadOwnSequence(user, id, MediaStatus.UPLOADING);
  const urls = await Promise.all(
    names.map(async (name) => {
      if (!isSafeFrameName(name)) throw badRequest(`Frame name rejected: « ${name} »`, 'BAD_FRAME_NAME');
      const parsed = parseFrameName(name);
      if (!parsed || parsed.extension !== sequence.extension)
        throw badRequest(`« ${name} » does not belong to ${sequence.pattern}`, 'FRAME_OUTSIDE_PATTERN');
      return {
        name,
        // Neutral type: the object is served from the application's origin, and the presigner does not sign
        // the header — it is the server that fixes the type, never the browser (see `lib/uploadContentType`).
        url: await storage.getPresignedPutUrl(
          sequenceFrameKey(sequence.storagePrefix, name),
          'application/octet-stream',
        ),
      };
    }),
  );
  return { urls };
}

/**
 * Closes the upload: what actually arrived is authoritative.
 *
 * The MinIO listing gives existence, size and count in one go; three re-read headers catch a misrepresented
 * format. A sequence missing some frames is not refused — it is a legitimate
 * partial delivery — but the count and the bounds written in the database are those of reality, never those
 * announced at opening.
 *
 * `note` is the upload brief: this function plays the role of `MediaService.finalize` for a sequence, so it
 * carries the same rule. Without it, "mandatory brief" would only have applied
 * to single files, and the artist would have learned it from the exception.
 */
export async function completeSequence(user: SessionUser, id: number, note?: string | null) {
  const { media, sequence } = await loadOwnSequence(user, id, MediaStatus.UPLOADING);
  // Checked BEFORE the bucket sweep and any write: refusing later would cost a complete listing for a missing
  // sentence, whereas the client only has to call back.
  const owner = await resolveProjectIdForVersion(media.versionId);
  const [draftMode, uploadNote] = await Promise.all([
    isDraftModeEnabled(),
    owner
      ? resolveProjectSettingsById(owner).then((cfg) => assertUploadNote(note, cfg.reviewRequest))
      : Promise.resolve(null),
  ]);

  const objects: { name: string; size: number }[] = [];
  for await (const object of storage.iterateObjects(sequence.storagePrefix)) {
    if (object.size > 0)
      objects.push({ name: object.key.slice(sequence.storagePrefix.length), size: object.size });
  }
  const frames = objects
    .map((o) => ({ ...o, frame: parseFrameName(o.name)?.number }))
    .filter((o): o is { name: string; size: number; frame: number } => o.frame !== undefined)
    .sort((a, b) => a.frame - b.frame);
  if (frames.length < MIN_SEQUENCE_FRAMES)
    throw badRequest('No frame reached storage for this image sequence', 'SEQUENCE_EMPTY');

  await assertFrameHeaders(sequence.storagePrefix, sequence.extension, frames);

  const totalSize = frames.reduce((acc, f) => acc + f.size, 0);
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (projectId) await assertProjectQuota(projectId, totalSize);

  const summary = sequenceSummary(frames.map((f) => f.frame));
  const manifest: SequenceManifest = {
    kind: 'image-sequence',
    pattern: sequence.pattern,
    extension: sequence.extension,
    digits: sequence.digits,
    startFrame: summary.startFrame,
    endFrame: summary.endFrame,
    frameCount: summary.frameCount,
    framerate: sequence.framerate,
    totalSize,
    prefix: sequence.storagePrefix,
    frames: frames.map((f) => ({ frame: f.frame, name: f.name, size: f.size })),
  };
  await storage.putObject(media.storageKey, Buffer.from(JSON.stringify(manifest)), 'application/json');

  const metadata: SequenceMeta = { ...(media.metadata as SequenceMeta) };
  delete metadata.sequencePending;
  if (uploadNote) metadata.uploadNote = uploadNote;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.imageSequence.update({
      where: { mediaObjectId: id },
      data: {
        startFrame: summary.startFrame,
        endFrame: summary.endFrame,
        frameCount: summary.frameCount,
        totalSize: BigInt(totalSize),
      },
    });
    return tx.mediaObject.update({
      where: { id },
      data: {
        status: MediaStatus.PROCESSING,
        size: BigInt(totalSize),
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
  });

  if (media.uploaderId) {
    await prisma.user.update({
      where: { id: media.uploaderId },
      data: { storageUsed: { increment: BigInt(totalSize) } },
    });
  }
  await enqueueMediaJob({ mediaObjectId: id, kind: 'transcode' });
  // Automatic publication (Phase 50): the sequence is a media like any other, born published outside draft
  // mode. Without this announcement, its version would remain "draft" in
  // the eyes of the computation and followers would never hear about the delivery.
  if (updated.published && !draftMode)
    await announcePublication(
      { id, versionId: media.versionId, kind: updated.kind, originalName: updated.originalName },
      owner,
      user.id,
    );
  logAudit({
    userId: user.id,
    action: 'MEDIA_SEQUENCE_UPLOAD',
    entityType: 'MediaObject',
    entityId: id,
    metadata: { pattern: sequence.pattern, frameCount: summary.frameCount, totalSize },
  });
  return {
    media: { id: updated.id, status: updated.status, size: totalSize },
    startFrame: summary.startFrame,
    endFrame: summary.endFrame,
    frameCount: summary.frameCount,
    missingFrames: summary.missingFrames,
  };
}

/** Re-reads the header of three frames and refuses the batch if one is not the announced image. */
async function assertFrameHeaders(
  prefix: string,
  extension: string,
  frames: { name: string; size: number }[],
): Promise<void> {
  const positions = new Set([0, Math.floor(frames.length / 2), frames.length - 1]);
  for (const index of [...positions].slice(0, HEADER_CHECK_POSITIONS)) {
    const frame = frames[index]!;
    const header = await storage.getObjectHeader(sequenceFrameKey(prefix, frame.name), 32);
    if (!validateMediaHeader(MediaKind.IMAGE, header, extension, frame.size))
      throw badRequest(`« ${frame.name} » is not a readable ${extension} image`, 'INVALID_FILE');
  }
}

/**
 * The original deliverable, frame by frame.
 *
 * A sequence of a thousand EXRs is not re-zipped on the fly inside the web process: the archive would weigh a
 * hundred gigabytes and occupy a connection for an hour. We therefore
 * return the manifest and the presigned URLs, which any client (browser, `curl`, studio tool) downloads in
 * parallel — under their original name, since that is what served as the key.
 */
export async function listSequenceFrames(user: SessionUser, id: number) {
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    include: { imageSequence: true },
  });
  if (!media?.imageSequence) throw notFound('Media has no image sequence');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Media has no image sequence');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw notFound('Media has no image sequence');

  const sequence = media.imageSequence;
  const objects: { name: string; size: number }[] = [];
  for await (const object of storage.iterateObjects(sequence.storagePrefix)) {
    if (object.size > 0)
      objects.push({ name: object.key.slice(sequence.storagePrefix.length), size: object.size });
  }
  objects.sort((a, b) => (parseFrameName(a.name)?.number ?? 0) - (parseFrameName(b.name)?.number ?? 0));
  const frames = await Promise.all(
    objects.map(async (o) => ({
      frame: parseFrameName(o.name)?.number ?? 0,
      name: o.name,
      size: o.size,
      // Response type imposed, and opaque: the PUT's signature does not cover the header, so a frame may have
      // been deposited as `text/html`. These objects are served from the
      // application's origin (nginx exposes MinIO under `/<bucket>/…`) — rendered, they would run script with
      // the session token. No frame has any reason to be displayed by the
      // browser: they are downloaded.
      url: await storage.getPresignedGetUrl(
        sequenceFrameKey(sequence.storagePrefix, o.name),
        FRAME_URL_TTL_SEC,
        OPAQUE_CONTENT_TYPE,
      ),
    })),
  );
  return {
    pattern: sequence.pattern,
    startFrame: sequence.startFrame,
    endFrame: sequence.endFrame,
    framerate: sequence.framerate,
    totalSize: Number(sequence.totalSize),
    frames,
  };
}
