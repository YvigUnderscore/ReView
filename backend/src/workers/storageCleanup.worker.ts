import { Worker } from 'bullmq';
import { redisConnectionOptions } from '../lib/redis';
import { QUEUE_NAMES, type StorageCleanupJobData } from '../services/JobService';
import { storage } from '../services/StorageService';
import { logger } from '../lib/logger';

/**
 * Worker de nettoyage storage (retry des orphelins MinIO).
 *
 * Alimenté par `enqueueStorageCleanup` (lib/trash) quand une suppression d'objet
 * échoue APRÈS le commit DB : la base est déjà cohérente, il ne reste qu'à retirer
 * l'objet orphelin. Toute erreur est propagée → BullMQ retente (attempts + backoff).
 * La suppression est idempotente (retirer une clé déjà absente n'échoue pas).
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

/** Démarre le worker (appelé depuis le process worker principal). */
export function startStorageCleanupWorker(): void {
  storageCleanupWorker.run();
  logger.info('[storageCleanup.worker] démarré.');
}
