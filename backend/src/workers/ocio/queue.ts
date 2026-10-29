// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Queue } from 'bullmq';
import { redisConnectionOptions } from '../../lib/redis';
import { logger } from '../../lib/logger';
import { registerShutdownTask, SHUTDOWN_PHASE } from '../../lib/gracefulShutdown';
import type { BakeRequest } from './bakeJob';

/**
 * Queue for display LUT baking. It is **separate** from `media-processing` for the same
 * reason as the spatial thumbnail: it is studio work, rare (installing a config,
 * changing OCIO tooling), which must neither delay a transcode nor make a media fail.
 *
 * The queue lives here rather than in `services/JobService.ts` because this batch does not own
 * that file; the `OCIO_BAKE: 'ocio-bake'` entry is meant to join `QUEUE_NAMES`.
 */
export const OCIO_BAKE_QUEUE = 'ocio-bake';

export const ocioBakeQueue = new Queue<BakeRequest, void, string>(OCIO_BAKE_QUEUE, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: 20,
    removeOnFail: 50,
  },
});

/**
 * The queue holds a Redis connection: without closing it, the API process does not return
 * after `server.close()`. `closeQueues()` (JobService) does not know about this one, so it
 * registers itself, in the same phase as the other queues.
 */
registerShutdownTask({
  name: 'ocio-bake-queue',
  phase: SHUTDOWN_PHASE.STOP_INTAKE,
  run: () => ocioBakeQueue.close(),
});

/**
 * Requests a bake. **Never throws**: a config installs even without a reachable Redis,
 * and the viewer can fall back to the colorimetric bake on demand.
 */
export async function enqueueOcioBake(req: BakeRequest): Promise<void> {
  try {
    await ocioBakeQueue.add('bake', req, {
      jobId: `${req.configId}:${req.display ?? '*'}:${req.view ?? '*'}`,
    });
  } catch (err) {
    logger.warn({ err, configId: req.configId }, 'ocio bake: enqueue failed');
  }
}
