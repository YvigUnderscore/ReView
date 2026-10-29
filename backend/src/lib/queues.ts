// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Queue } from 'bullmq';
import { redisConnectionOptions } from '../lib/redis';

/**
 * BullMQ job queues. The FFmpeg workers (transcoding, thumbnails) and the 3D conversion (assimp) are
 * implemented in src/workers/.
 */
export const QUEUE_NAMES = {
  MEDIA: 'media-processing',
  STORAGE_CLEANUP: 'storage-cleanup',
  WEBHOOKS: 'webhooks',
  TIMELINE_EXPORT: 'timeline-export',
  SHOTGRID: 'shotgrid',
  MAINTENANCE: 'maintenance',
  SPATIAL_THUMB: 'spatial-thumb',
} as const;

/**
 * ShotGrid jobs (Phase 48): applying a received event, periodic reading of the event log, reconciliation, and
 * writes to ShotGrid. A single queue: the relative order of the operations on one connection matters more
 * than parallelism.
 */
export type ShotgridJobData =
  | { kind: 'event'; connectionId: number; event: unknown; deliveryId?: string | null }
  | { kind: 'poll'; connectionId: number }
  | { kind: 'reconcile'; projectId: number }
  | { kind: 'push'; connectionId: number; push: unknown };

export interface MediaJobData {
  mediaObjectId: number;
  // 'scan' (37.E): antivirus alone, for media served as they are (native GLB, splats).
  kind: 'transcode' | 'thumbnail' | 'convert3d' | 'scan';
}

export const mediaQueue = new Queue<MediaJobData, void, string>(QUEUE_NAMES.MEDIA, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const enqueueMediaJob = (data: MediaJobData) => mediaQueue.add(data.kind, data);

/**
 * Thumbnail of a spatial media (3D / Gaussian splat) — a **dedicated** queue, separate from
 * `media-processing`.
 *
 * Why not one more `kind` on the media queue: this work is decorative. It must never move a media to
 * `PROCESSING` or `FAILED`, it occupies the CPU for a long time (Cycles rendering) and it must be able to
 * fail without consequence. A separate queue with concurrency 1 isolates it from transcoding, which blocks
 * the user.
 */
export interface SpatialThumbJobData {
  mediaObjectId: number;
}

export const spatialThumbQueue = new Queue<SpatialThumbJobData, void, string>(QUEUE_NAMES.SPATIAL_THUMB, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    // The GLB only exists once the conversion has finished: the first attempts may arrive too early. The
    // exponential back-off leaves more than an hour in total, which covers a heavy USD scene without
    // occupying the queue in the meantime.
    attempts: 8,
    backoff: { type: 'exponential', delay: 30_000 },
    // Deterministic identifier (anti-duplicate): expiry frees the key, otherwise a later `reprocess` of the
    // same media would be silently ignored.
    removeOnComplete: { age: 600, count: 100 },
    removeOnFail: { age: 86_400, count: 200 },
  },
});

/** A single render in flight per media: two closely spaced uploads/reprocesses do not launch two. */
export const spatialThumbJobId = (mediaObjectId: number) => `spatial-thumb-${mediaObjectId}`;

export const enqueueSpatialThumb = (data: SpatialThumbJobData) =>
  spatialThumbQueue.add('render', data, { jobId: spatialThumbJobId(data.mediaObjectId) });

/**
 * Log of storage orphans: when a MinIO deletion FAILS AFTER the database has already been purged (see
 * lib/trash), the keys/prefixes are enqueued here for retry (the database stays consistent; only the storage
 * object remains temporarily). Automatic BullMQ retries (attempts + backoff) handled by
 * workers/storageCleanup.worker.
 */
export interface StorageCleanupJobData {
  keys?: string[];
  prefixes?: string[];
}

export const storageCleanupQueue = new Queue<StorageCleanupJobData, void, string>(
  QUEUE_NAMES.STORAGE_CLEANUP,
  {
    connection: redisConnectionOptions,
    defaultJobOptions: {
      attempts: 8,
      backoff: { type: 'exponential', delay: 15000 },
      removeOnComplete: 100,
      removeOnFail: 1000,
    },
  },
);

export const enqueueStorageCleanup = (data: StorageCleanupJobData) =>
  storageCleanupQueue.add('cleanup', data);

/** Webhook delivery (36.D): one job per subscribed webhook, automatic retries. */
export interface WebhookJobData {
  webhookId: number;
  event: string;
  payload: Record<string, unknown>;
}

export const webhookQueue = new Queue<WebhookJobData, void, string>(QUEUE_NAMES.WEBHOOKS, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

export const enqueueWebhookDelivery = (data: WebhookJobData) => webhookQueue.add(data.event, data);

export const shotgridQueue = new Queue<ShotgridJobData, void, string>(QUEUE_NAMES.SHOTGRID, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    // A single attempt for events: the periodic reconciliation catches what failed, better than a pile-up of
    // retries on an unavailable site.
    attempts: 2,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

/**
 * Export of an edit as a single file (Phase 45). One job at a time per edit: the job identifier is
 * deterministic, and BullMQ silently ignores a duplicate — two clicks on
 * "export" do not launch two encodings of the same film.
 */
export interface TimelineExportJobData {
  timelineId: number;
  requestedById: number;
}

export const timelineExportQueue = new Queue<TimelineExportJobData, void, string>(
  QUEUE_NAMES.TIMELINE_EXPORT,
  {
    connection: redisConnectionOptions,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  },
);

export const timelineExportJobId = (timelineId: number) => `timeline-${timelineId}`;

export const enqueueTimelineExport = (data: TimelineExportJobData) =>
  timelineExportQueue.add('export', data, { jobId: timelineExportJobId(data.timelineId) });

/**
 * Periodic maintenance (daily digest, weekly report, purges).
 *
 * These three appointments used to live in `setInterval` timers of the API process: they died with it, were
 * duplicated across two replicas, and nothing said whether they had taken place.
 * Moved to a queue, they are scheduled by the API (which alone knows `DIGEST_HOUR`) and executed by the
 * worker, with history, retries and the dashboard of the other queues.
 */
export type MaintenanceJobData = { kind: 'daily-digest' } | { kind: 'weekly-report' } | { kind: 'purge' };

export const maintenanceQueue = new Queue<MaintenanceJobData, void, string>(QUEUE_NAMES.MAINTENANCE, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    // A missed appointment is caught up by the next one: better two attempts than a pile-up of retries on a
    // SMTP server that is durably unreachable.
    attempts: 2,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

/**
 * All declared queues — the single source for metrics and the dashboard.
 *
 * The label is not the queue name: `media-processing` has always been exposed as `queue="media"` in
 * Prometheus, in the provisioned Grafana dashboard and in the operations documentation.
 * Renaming it would break the existing queries.
 */
export const QUEUE_LABELS = {
  media: mediaQueue,
  'storage-cleanup': storageCleanupQueue,
  webhooks: webhookQueue,
  'timeline-export': timelineExportQueue,
  shotgrid: shotgridQueue,
  maintenance: maintenanceQueue,
  'spatial-thumb': spatialThumbQueue,
} as const;

export type QueueLabel = keyof typeof QUEUE_LABELS;

export const ALL_QUEUES = Object.entries(QUEUE_LABELS) as ReadonlyArray<readonly [QueueLabel, Queue]>;

/**
 * Closes all queues (clean shutdown of the API process): without this, the Redis connections of the `Queue`
 * instances keep the process alive after `server.close()`.
 */
export async function closeQueues(): Promise<void> {
  await Promise.all(Object.values(QUEUE_LABELS).map((q) => q.close()));
}
