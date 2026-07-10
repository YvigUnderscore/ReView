import { Queue } from 'bullmq';
import { redisConnectionOptions } from '../lib/redis';

/**
 * Files de jobs BullMQ. Les workers FFmpeg (transcodage, miniatures) et la conversion 3D
 * (assimp) sont implémentés dans src/workers/.
 */
export const QUEUE_NAMES = {
  MEDIA: 'media-processing',
  STORAGE_CLEANUP: 'storage-cleanup',
} as const;

export interface MediaJobData {
  mediaObjectId: number;
  kind: 'transcode' | 'thumbnail' | 'convert3d' | 'trim';
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
 * Journal des orphelins storage : quand une suppression MinIO échoue APRÈS que la DB
 * a déjà été purgée (cf. lib/trash), on enfile les clés/préfixes ici pour retry
 * (la DB reste cohérente ; seul l'objet storage subsiste temporairement). Retries
 * automatiques BullMQ (attempts + backoff) traités par workers/storageCleanup.worker.
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
