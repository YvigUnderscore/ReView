// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from '../../lib/logger';
import { shotgridQueue } from '../JobService';
import { listActiveConnections } from './ShotgridSyncService';
import { parseSettings } from './shotgridSettings';

/**
 * Rythme des travaux ShotGrid : relevé périodique et réconciliation nocturne.
 *
 * Ce module ne crée aucun `Worker` — c'est toute sa raison d'être. Le planificateur
 * vivait dans le module du worker, si bien qu'une route qui aurait voulu le rappeler
 * après un changement de réglages aurait démarré un second consommateur de file dans le
 * process API. Faute de pouvoir l'appeler, les réglages de rythme ne prenaient effet
 * qu'au redémarrage : basculer une connexion en « relevé » ne relevait rien avant le
 * prochain déploiement.
 */

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
          jobId: `sgpoll-${conn.id}`,
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
          jobId: `sgreconcile-${conn.id}`,
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
      { delay, jobId: `sgboot-${conn.id}-${Date.now()}`, removeOnComplete: 20 },
    );
    delay += 15_000;
  }
}
