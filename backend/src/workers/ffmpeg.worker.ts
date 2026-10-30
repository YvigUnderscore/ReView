// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Worker } from 'bullmq';
import { redisConnectionOptions } from '../lib/redis';
import { QUEUE_NAMES, type MediaJobData } from '../lib/queues';
import { prisma } from '../lib/prisma';
import { MediaStatus, Prisma } from '@prisma/client';
import { logger } from '../lib/logger';
import { startStorageCleanupWorker } from './storageCleanup.worker';
import { startWebhookWorker } from './webhook.worker';
import { startShotgridWorker } from './shotgrid.worker';
import { startTimelineExportWorker } from './timelineExport.worker';
import { startMaintenanceWorker } from './maintenance.worker';
import { startSpatialThumbWorker } from './spatialThumb.worker';
import { startOcioBakeWorker } from './ocio/bake.worker';
import { registerWorkerShutdown } from './shutdown';
import { mediaJobProgress } from '../lib/mediaProgress';
import { installShutdownHandlers, registerShutdownTask, SHUTDOWN_PHASE } from '../lib/gracefulShutdown';
import { closeWorkerEvents } from '../lib/workerEvents';
import { startWorkerMetricsServer, attachWorkerMetrics } from './metricsServer';
import { ignoreFailure } from '../lib/ignoreFailure';
import { handle, progressReporter, recordScanOutcome } from './ffmpeg/mediaJob';

/**
 * Media processing worker (FFmpeg) — BullMQ.
 *
 * Flow: downloads the object from MinIO to a temporary directory, processes it with FFmpeg, pushes the derivatives back to MinIO, updates MediaObject (status, thumbnailKey,
 * metadata), then cleans up the temporary directory. No file persists on the app server.
 *
 *  - thumbnail: JPEG thumbnail (resizing for images; video captures the middle frame)
 *  - transcode: probe (ffprobe) + MP4 proxy (h264/aac, faststart) + thumbnail
 *  - convert3d: conversion of FBX/OBJ/USD... to GLB (see services/ModelConvertService, 9.A1 then 45.C)
 *
 * Run as a separate process: `node dist/workers/ffmpeg.worker.js` (the `worker` service of the compose file).
 */

/**
 * Puts a media into failure **while keeping the reason** (45.C): without it, the review displays only a silent `FAILED` status — insufficient for USD, where the failure most often
 * comes from something the user can correct (missing asset in the zip, absent tooling).
 */
async function markFailed(mediaId: number, err: unknown): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).trim().slice(0, 500);
  try {
    const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
    const metadata: Record<string, unknown> = { ...((media?.metadata ?? {}) as object) };
    metadata.processingError = message;
    await prisma.mediaObject.update({
      where: { id: mediaId },
      data: { status: MediaStatus.FAILED, metadata: metadata as Prisma.InputJsonObject },
    });
  } catch {
    // The status update must never mask the original error (re-thrown by the caller).
  }
}

export const ffmpegWorker = new Worker<MediaJobData>(
  QUEUE_NAMES.MEDIA,
  async (job) => {
    try {
      await handle(job.data.mediaObjectId, job.data.kind, progressReporter(job));
      await job
        .updateProgress(mediaJobProgress(job.data.kind, 'done'))
        .catch(ignoreFailure('[ffmpeg] progress update failed', { jobId: job.id }));
    } catch (err) {
      // A scan in error (clamd unreachable) does not condemn the media — BullMQ retries; only a detection sets FAILED. But it leaves a media served WITHOUT having been
      // scanned: it now says so on the media, failing which the absence of a scan was indistinguishable from a clean scan (see `recordScanOutcome`).
      if (job.data.kind === 'scan') {
        await recordScanOutcome(job.data.mediaObjectId, {
          failed: err instanceof Error ? err.message : String(err),
        });
      } else {
        await markFailed(job.data.mediaObjectId, err);
      }
      throw err;
    }
  },
  { connection: redisConnectionOptions, autorun: false, concurrency: 2 },
);

ffmpegWorker.on('completed', (job) =>
  logger.info(`[ffmpeg.worker] ✓ ${job.name} media=${job.data.mediaObjectId}`),
);
ffmpegWorker.on('failed', (job, err) =>
  logger.error({ err }, `[ffmpeg.worker] ✗ media=${job?.data.mediaObjectId}`),
);

if (require.main === module) {
  // The collection point BEFORE the consumers: it is the component whose holding up one most needs to know, and a worker that dies at startup must be detectable.
  // The module registers its own shutdown, and a port already taken does not bring it down.
  startWorkerMetricsServer();
  // Without this wiring, /metrics only renders the state of the process — never its work.
  // The media queue carries most of the cost (transcoding, HLS, thumbnails, 3D conversions); the six other consumers start through functions that do not return their worker,
  // wiring them in would require changing their signature (left to a dedicated batch).
  attachWorkerMetrics('media', ffmpegWorker);
  // The worker loop lives as long as the process: nothing to await here.
  void ffmpegWorker.run();
  registerWorkerShutdown('ffmpeg.worker', ffmpegWorker);
  logger.info('[ffmpeg.worker] started.');
  // Same worker process: also processes the storage cleanup queue (retry of orphans) and the delivery of webhooks (36.D — outgoing POSTs do not leave from the web server).
  startStorageCleanupWorker();
  startWebhookWorker();
  // Export of automatic timelines (45): same process, dedicated queue at concurrency 1.
  startTimelineExportWorker();
  // ShotGrid integration (48): events, periodic polling, reconciliation and outgoing writes — with catch-up at startup after an outage.
  startShotgridWorker();
  // Periodic maintenance (digest, weekly report, purges): scheduled by the API, executed here — it used to be three `setInterval`s of the web process.
  startMaintenanceWorker();
  // Spatial media thumbnails (3D, splat): `MediaService.requestSpatialThumb` enqueued, from three places, a queue that nobody consumed.
  startSpatialThumbWorker();
  // OCIO LUT baking: the admin route answered `202 { queued: true }` on a queue without a consumer, and the viewer fell back indefinitely on the internal LUT.
  startOcioBakeWorker();

  // Clean shutdown: the queue consumers first ("stop accepting" phase), then the Redis connections of the event channel and the database.
  registerShutdownTask({
    name: 'worker-events',
    phase: SHUTDOWN_PHASE.DISCONNECT,
    run: () => closeWorkerEvents(),
  });
  registerShutdownTask({
    name: 'prisma',
    phase: SHUTDOWN_PHASE.DISCONNECT,
    run: () => prisma.$disconnect(),
  });
  installShutdownHandlers();
}
