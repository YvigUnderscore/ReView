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
 * ShotGrid jobs: applying received events, periodic polling, outgoing writes
 * and reconciliation.
 *
 * Reconciliation deserves a word. ReView is not always reachable: an update,
 * a network outage, a webhook that ShotGrid eventually disabled after a hundred
 * failures, and the mirror drifts without anyone noticing. Two safety nets:
 * a nightly pass, and a catch-up at instance startup that re-reads everything that
 * changed during the absence. ShotGrid is authoritative: on wake-up, ReView realigns.
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

// Re-export: the scheduler now lives in a module with no side effects, so that
// the API process can call it after a settings change without instantiating this
// worker at the same time.
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
