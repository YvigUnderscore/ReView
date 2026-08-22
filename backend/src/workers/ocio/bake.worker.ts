// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Worker } from 'bullmq';
import { redisConnectionOptions } from '../../lib/redis';
import { logger } from '../../lib/logger';
import { registerWorkerShutdown } from '../shutdown';
import { runBake, type BakeRequest } from './bakeJob';
import { OCIO_BAKE_QUEUE } from './queue';

/**
 * Worker de cuisson des LUT d'affichage OCIO. Il tourne dans le process worker, seul endroit
 * où vit l'outillage lourd (venv Python) : l'API, elle, ne sait cuire que le repli intégré.
 *
 * Concurrence 1 : cuire deux configs en parallèle ne rend rien de plus vite (un `.cube` 33³
 * se calcule en moins d'une seconde) et sérialiser évite deux téléchargements du `.ocio`.
 */
export const ocioBakeWorker = new Worker<BakeRequest, void, string>(
  OCIO_BAKE_QUEUE,
  async (job) => {
    await runBake(job.data);
  },
  { connection: redisConnectionOptions, autorun: false, concurrency: 1 },
);

ocioBakeWorker.on('completed', (job) => logger.info(`[ocio.bake.worker] ✓ config ${job.data.configId}`));
ocioBakeWorker.on('failed', (_job, err) => logger.warn({ err }, '[ocio.bake.worker] ✗ (sera retenté)'));

/** Démarre le worker (appelé depuis le process worker principal). */
export function startOcioBakeWorker(): void {
  void ocioBakeWorker.run();
  registerWorkerShutdown('ocio.bake.worker', ocioBakeWorker);
  logger.info('[ocio.bake.worker] démarré.');
}
