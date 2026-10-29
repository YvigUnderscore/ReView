// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Worker } from 'bullmq';
import { redisConnectionOptions } from '../lib/redis';
import { QUEUE_NAMES, type StorageCleanupJobData } from '../services/JobService';
import { storage } from '../services/StorageService';
import { logger } from '../lib/logger';
import { registerWorkerShutdown } from './shutdown';

/**
 * Storage cleanup worker (retries orphaned MinIO objects).
 *
 * Fed by `enqueueStorageCleanup` (lib/trash) when an object deletion
 * fails AFTER the DB commit: the database is already consistent, all that remains is to remove
 * the orphaned object. Any error is propagated, so BullMQ retries (attempts + backoff).
 * Deletion is idempotent (removing a key that is already absent does not fail).
 */
export const storageCleanupWorker = new Worker<StorageCleanupJobData, void, string>(
  QUEUE_NAMES.STORAGE_CLEANUP,
  async (job) => {
    for (const key of job.data.keys ?? []) {
      await storage.deleteObject(key);
    }
    for (const prefix of job.data.prefixes ?? []) {
      await storage.deletePrefix(prefix);
    }
  },
  { connection: redisConnectionOptions, autorun: false, concurrency: 2 },
);

storageCleanupWorker.on('completed', (job) =>
  logger.info(
    `[storageCleanup.worker] ✓ ${job.data.keys?.length ?? 0} clé(s) / ${job.data.prefixes?.length ?? 0} préfixe(s)`,
  ),
);
storageCleanupWorker.on('failed', (_job, err) =>
  logger.warn({ err }, '[storageCleanup.worker] ✗ (sera retenté)'),
);

/** Starts the worker (called from the main worker process). */
export function startStorageCleanupWorker(): void {
  // The worker loop lives as long as the process: nothing to wait for here.
  void storageCleanupWorker.run();
  registerWorkerShutdown('storageCleanup.worker', storageCleanupWorker);
  logger.info('[storageCleanup.worker] démarré.');
}
