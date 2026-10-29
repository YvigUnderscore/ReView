// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus } from '@prisma/client';
import { Worker } from 'bullmq';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';

import { redisConnectionOptions } from '../lib/redis';
import { QUEUE_NAMES, type SpatialThumbJobData } from '../services/JobService';
import { prisma } from '../lib/prisma';
import { storage, StorageService } from '../services/StorageService';
import { logger } from '../lib/logger';
import { getExtension } from '../lib/fileSignatures';
import { spatialThumbSource } from '../lib/mediaJobKind';
import { readSplatCloud } from '../lib/splatPoints';
import { renderPointCloudPng } from '../lib/pointThumbnail';
import { renderModelThumbnail } from '../services/ModelConvertService';
import { registerWorkerShutdown } from './shutdown';
import { ignoreFailure } from '../lib/ignoreFailure';

/**
 * **Spatial thumbnail** worker: produces the preview of 3D media and Gaussian splats.
 *
 * The gap it fills: `jobKindFor` triggered nothing for a splat nor for a native `.glb`,
 * and the `convert3d` branch of the FFmpeg worker wrote no `thumbnailKey`. A shot page full of
 * 3D assets only showed empty tiles until a human
 * opened each review to capture the view by hand.
 *
 * Trois invariants tenus par ce worker :
 *  1. **It never touches the media status.** No media can stay stuck in
 *     `PROCESSING` because of a thumbnail, and an impossible render (Blender missing from
 *     the image, splat in an unreadable container) is a *successful* job without an image.
 *  2. **It never overwrites an existing thumbnail**: conditional write on
 *     `thumbnailKey IS NULL`, the same guard as the client capture (`setAutoThumbnail`).
 *     The job is therefore idempotent and safe to replay.
 *  3. **It is bounded in time**: the Blender render has its own maximum delay
 *     (`BLENDER_THUMB_TIMEOUT_MS`, same pattern as `lib/ffmpegTimeout`), and reading a
 *     splat is a streaming pass with constant memory.
 */

/** Budget of retained points in a splat: beyond it, the thumbnail gains nothing. */
export const SPLAT_THUMB_MAX_POINTS = 160_000;

export type SpatialThumbOutcome =
  'missing' | 'exists' | 'unsupported' | 'pending' | 'no-render' | 'raced' | 'rendered';

/**
 * The derived GLB does not exist yet: the conversion is in flight. An *expected* error whose
 * sole purpose is to make BullMQ reschedule the job (exponential backoff).
 */
export class SpatialThumbPendingError extends Error {
  readonly mediaObjectId: number;

  constructor(mediaObjectId: number) {
    super(`spatial thumbnail for media ${mediaObjectId}: the converted GLB is not available yet`);
    this.name = 'SpatialThumbPendingError';
    this.mediaObjectId = mediaObjectId;
  }
}

/** Renders and stores the thumbnail of a spatial media. Only throws on infrastructure incidents. */
export async function renderSpatialThumb(mediaId: number): Promise<SpatialThumbOutcome> {
  const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
  if (!media) return 'missing';
  if (media.thumbnailKey) return 'exists';

  const ext = getExtension(media.originalName);
  const source = spatialThumbSource(media.kind, ext);
  if (!source) return 'unsupported';

  const metadata = (media.metadata ?? {}) as { glbKey?: unknown };
  const dir = await mkdtemp(join(tmpdir(), 'review-thumb-'));
  try {
    const png = join(dir, 'thumb.png');

    if (source === 'model') {
      const glbKey =
        typeof metadata.glbKey === 'string' ? metadata.glbKey : ext === '.glb' ? media.storageKey : null;
      // No GLB yet: either the conversion is running (we'll come back), or it failed and
      // there is nothing to render. Either way the media status is not our concern.
      if (!glbKey) return media.status === MediaStatus.PROCESSING ? 'pending' : 'unsupported';
      const glb = join(dir, 'model.glb');
      await storage.downloadToFile(glbKey, glb);
      const result = await renderModelThumbnail(glb, png);
      if (!result.rendered) {
        logger.warn(`[spatialThumb.worker] média ${mediaId} non rendu (${result.reason})`);
        return 'no-render';
      }
    } else {
      const src = join(dir, `src${ext}`);
      await storage.downloadToFile(media.storageKey, src);
      const { size } = await stat(src);
      const read = await readSplatCloud(src, ext, size, SPLAT_THUMB_MAX_POINTS);
      if (!read.ok) {
        logger.warn(`[spatialThumb.worker] splat ${mediaId} illisible (${read.reason})`);
        return 'no-render';
      }
      const buf = renderPointCloudPng(read.cloud);
      if (!buf) {
        logger.warn(`[spatialThumb.worker] splat ${mediaId} : nuage dégénéré, aucune vignette`);
        return 'no-render';
      }
      await writeFile(png, buf);
    }

    const key = StorageService.thumbnailKey(mediaId, 'png');
    await storage.uploadFile(key, png, 'image/png');
    // Conditional write: a concurrent client capture may have won in the meantime.
    const { count } = await prisma.mediaObject.updateMany({
      where: { id: mediaId, thumbnailKey: null },
      data: { thumbnailKey: key },
    });
    if (count === 0) {
      await storage.deleteObject(key).catch(ignoreFailure('[spatial-thumb] object cleanup failed', { key }));
      return 'raced';
    }
    return 'rendered';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const spatialThumbWorker = new Worker<SpatialThumbJobData, void, string>(
  QUEUE_NAMES.SPATIAL_THUMB,
  async (job) => {
    const mediaId = job.data.mediaObjectId;
    const outcome = await renderSpatialThumb(mediaId);
    if (outcome === 'pending') throw new SpatialThumbPendingError(mediaId);
    logger.info(`[spatialThumb.worker] media=${mediaId} → ${outcome}`);
  },
  // Concurrency 1: a Cycles render saturates the available cores; running two would
  // only slow both down, and steal CPU from transcoding, blocking it.
  { connection: redisConnectionOptions, autorun: false, concurrency: 1 },
);

spatialThumbWorker.on('failed', (job, err) =>
  err instanceof SpatialThumbPendingError
    ? logger.debug(`[spatialThumb.worker] media=${job?.data.mediaObjectId} en attente du GLB`)
    : logger.warn({ err }, `[spatialThumb.worker] ✗ media=${job?.data.mediaObjectId}`),
);

/** Starts the worker (called from the main worker process). */
export function startSpatialThumbWorker(): void {
  // The worker loop lives as long as the process: nothing to wait for here.
  void spatialThumbWorker.run();
  registerWorkerShutdown('spatialThumb.worker', spatialThumbWorker);
  logger.info('[spatialThumb.worker] démarré.');
}
