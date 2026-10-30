// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Worker } from 'bullmq';
import { redisConnectionOptions } from '../../lib/redis';
import { logger } from '../../lib/logger';
import { registerWorkerShutdown } from '../shutdown';
import { runBake, type BakeRequest } from './bakeJob';
import { OCIO_BAKE_QUEUE } from './queue';

/**
 * OCIO display LUT baking worker. It runs in the worker process, the only place where
 * the heavy tooling (Python venv) lives: the API can only bake the built-in fallback.
 *
 * Concurrency 1: baking two configs in parallel gains nothing (a 33³ `.cube` takes under
 * a second to compute), and serializing avoids two downloads of the `.ocio`.
 */
export const ocioBakeWorker = new Worker<BakeRequest, void, string>(
  OCIO_BAKE_QUEUE,
  async (job) => {
    await runBake(job.data);
  },
  { connection: redisConnectionOptions, autorun: false, concurrency: 1 },
);

ocioBakeWorker.on('completed', (job) => logger.info(`[ocio.bake.worker] ✓ config ${job.data.configId}`));
ocioBakeWorker.on('failed', (_job, err) => logger.warn({ err }, '[ocio.bake.worker] ✗ (will be retried)'));

/** Starts the worker (called from the main worker process). */
export function startOcioBakeWorker(): void {
  void ocioBakeWorker.run();
  registerWorkerShutdown('ocio.bake.worker', ocioBakeWorker);
  logger.info('[ocio.bake.worker] started.');
}
