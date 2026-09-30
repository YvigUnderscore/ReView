// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Queue } from 'bullmq';
import { redisConnectionOptions } from '../../lib/redis';
import { logger } from '../../lib/logger';
import { registerShutdownTask, SHUTDOWN_PHASE } from '../../lib/gracefulShutdown';
import type { BakeRequest } from './bakeJob';

/**
 * File de cuisson des LUT d'affichage. Elle est **à part** de `media-processing` pour la même
 * raison que la vignette spatiale : c'est un travail de studio, rare (installation d'une config,
 * changement d'outillage OCIO), qui ne doit ni retarder un transcodage ni faire échouer un média.
 *
 * La file vit ici plutôt que dans `services/JobService.ts` parce que ce lot n'a pas la main sur
 * ce fichier ; l'entrée `OCIO_BAKE: 'ocio-bake'` a vocation à rejoindre `QUEUE_NAMES`.
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
 * La file tient une connexion Redis : sans fermeture, le process API ne rend pas la main
 * après `server.close()`. `closeQueues()` (JobService) ne connaît pas celle-ci — elle
 * s'enregistre donc elle-même, dans la même phase que les autres files.
 */
registerShutdownTask({
  name: 'ocio-bake-queue',
  phase: SHUTDOWN_PHASE.STOP_INTAKE,
  run: () => ocioBakeQueue.close(),
});

/**
 * Demande une cuisson. **Ne jette jamais** : une config s'installe même sans Redis joignable,
 * et le viewer sait cuire à la demande le repli colorimétrique.
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
