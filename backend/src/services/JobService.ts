import { Queue } from 'bullmq';
import { redisConnectionOptions } from '../lib/redis';

/**
 * Files de jobs BullMQ. Squelette 8.1 — les workers FFmpeg (transcodage, miniatures,
 * GIF turntable) seront implémentés en 8.3 dans src/workers/.
 */
export const QUEUE_NAMES = {
  MEDIA: 'media-processing',
} as const;

export interface MediaJobData {
  mediaObjectId: number;
  kind: 'transcode' | 'thumbnail' | 'turntable' | 'convert3d';
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
