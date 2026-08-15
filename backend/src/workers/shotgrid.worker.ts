// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Worker } from 'bullmq';
import { redisConnectionOptions } from '../lib/redis';
import { logger } from '../lib/logger';
import { QUEUE_NAMES, shotgridQueue, type ShotgridJobData } from '../services/JobService';
import {
  handleEvent,
  pollEvents,
  type ShotgridEventPayload,
} from '../services/shotgrid/ShotgridEventService';
import { listActiveConnections, runReconcile } from '../services/shotgrid/ShotgridSyncService';
import { runPush, type PushJob } from '../services/shotgrid/ShotgridPushService';
import { parseSettings } from '../services/shotgrid/shotgridSettings';

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

/**
 * (Re)pose les travaux périodiques d'après les réglages de chaque connexion.
 * Appelée au démarrage et après toute modification des réglages : une connexion
 * basculée de webhook à relevé doit voir son rythme changer sans redémarrage.
 */
export async function scheduleShotgridJobs(): Promise<void> {
  const repeatables = await shotgridQueue.getRepeatableJobs();
  for (const job of repeatables) {
    if (job.name === 'poll' || job.name === 'reconcile') {
      await shotgridQueue.removeRepeatableByKey(job.key);
    }
  }

  const connections = await listActiveConnections();
  for (const conn of connections) {
    if (conn.project.deletedAt) continue;
    const settings = parseSettings(conn.settings);

    if (settings.eventMode === 'polling') {
      await shotgridQueue.add(
        'poll',
        { kind: 'poll', connectionId: conn.id },
        {
          repeat: { every: settings.pollingIntervalSec * 1000 },
          jobId: `sgpoll:${conn.id}`,
          removeOnComplete: 20,
        },
      );
    }

    if (settings.reconcile.enabled) {
      await shotgridQueue.add(
        'reconcile',
        { kind: 'reconcile', projectId: conn.projectId },
        {
          repeat: { pattern: `0 ${settings.reconcile.hour} * * *` },
          jobId: `sgreconcile:${conn.id}`,
          removeOnComplete: 20,
        },
      );
    }
  }
  logger.info({ connections: connections.length }, '[shotgrid.worker] travaux périodiques posés');
}

/**
 * Rattrapage au démarrage : l'instance vient peut-être de passer des heures hors ligne.
 * Décalé de quelques secondes pour ne pas concurrencer le démarrage du service, et
 * étalé entre les connexions pour ne pas marteler le site du studio.
 */
export async function catchUpOnBoot(): Promise<void> {
  const connections = await listActiveConnections();
  let delay = 10_000;
  for (const conn of connections) {
    if (conn.project.deletedAt) continue;
    const settings = parseSettings(conn.settings);
    if (!settings.reconcile.onBoot) continue;
    await shotgridQueue.add(
      'reconcile',
      { kind: 'reconcile', projectId: conn.projectId },
      { delay, jobId: `sgboot:${conn.id}:${Date.now()}`, removeOnComplete: 20 },
    );
    delay += 15_000;
  }
}

export function startShotgridWorker(): void {
  void shotgridWorker.run();
  void scheduleShotgridJobs().catch((err) =>
    logger.error({ err }, '[shotgrid.worker] pose des travaux périodiques impossible'),
  );
  void catchUpOnBoot().catch((err) =>
    logger.error({ err }, '[shotgrid.worker] rattrapage au démarrage impossible'),
  );
  logger.info('[shotgrid.worker] démarré.');
}
