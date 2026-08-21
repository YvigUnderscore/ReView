// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Worker } from 'bullmq';
import { redisConnectionOptions } from '../lib/redis';
import { logger } from '../lib/logger';
import { QUEUE_NAMES, type ShotgridJobData } from '../services/JobService';
import {
  handleEvent,
  pollEvents,
  type ShotgridEventPayload,
} from '../services/shotgrid/ShotgridEventService';
import { runReconcile } from '../services/shotgrid/ShotgridSyncService';
import { runPush, type PushJob } from '../services/shotgrid/ShotgridPushService';
import { catchUpOnBoot, scheduleShotgridJobs } from '../services/shotgrid/ShotgridSchedule';
import { registerWorkerShutdown } from './shutdown';

/**
 * Travaux ShotGrid : application des événements reçus, relevé périodique, écritures
 * sortantes et réconciliation.
 *
 * La réconciliation mérite un mot. ReView n'est pas toujours joignable : une mise à
 * jour, une coupure réseau, un webhook que ShotGrid a fini par désactiver après cent
 * échecs — et le miroir dérive sans que personne ne s'en aperçoive. Deux filets :
 * un passage nocturne, et un rattrapage au démarrage de l'instance qui relit tout ce
 * qui a bougé pendant l'absence. ShotGrid fait autorité : au réveil, ReView se réaligne.
 */
export const shotgridWorker = new Worker<ShotgridJobData, void, string>(
  QUEUE_NAMES.SHOTGRID,
  async (job) => {
    const data = job.data;
    switch (data.kind) {
      case 'event':
        await handleEvent(data.connectionId, data.event as ShotgridEventPayload);
        return;
      case 'poll':
        await pollEvents(data.connectionId);
        return;
      case 'reconcile':
        await runReconcile(data.projectId);
        return;
      case 'push':
        await runPush(data.connectionId, data.push as PushJob);
        return;
      default:
        logger.warn({ data }, '[shotgrid.worker] type de travail inconnu');
    }
  },
  { connection: redisConnectionOptions, autorun: false, concurrency: 2 },
);

shotgridWorker.on('failed', (job, err) =>
  logger.warn({ err, kind: job?.data.kind }, '[shotgrid.worker] échec'),
);

// Réexport : le planificateur vit désormais dans un module sans effet de bord, pour que
// le process API puisse le rappeler après un changement de réglages sans instancier ce
// worker au passage.
export { catchUpOnBoot, scheduleShotgridJobs };

export function startShotgridWorker(): void {
  void shotgridWorker.run();
  registerWorkerShutdown('shotgrid.worker', shotgridWorker);
  void scheduleShotgridJobs().catch((err) =>
    logger.error({ err }, '[shotgrid.worker] pose des travaux périodiques impossible'),
  );
  void catchUpOnBoot().catch((err) =>
    logger.error({ err }, '[shotgrid.worker] rattrapage au démarrage impossible'),
  );
  logger.info('[shotgrid.worker] démarré.');
}
