// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from '../../lib/logger';
import { shotgridQueue } from '../../lib/queues';
import { listActiveConnections } from './ShotgridSyncService';
import { parseSettings } from './shotgridSettings';

/**
 * Rhythm of ShotGrid jobs: periodic reading and nightly reconciliation.
 *
 * This module creates no `Worker` — that is its whole reason for being. The scheduler lived in the worker's module, so a route that wanted to call it again after a
 * settings change would have started a second queue consumer in the API process. Unable to call it, the rhythm settings only took effect at restart: switching a
 * connection to "polling" polled nothing until the next deployment.
 */

/**
 * (Re)sets the periodic jobs from each connection's settings.
 * Called at startup and after any settings change: a connection switched from webhook to polling must see its rhythm change without a restart.
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
  logger.info({ connections: connections.length }, '[shotgrid.worker] periodic jobs scheduled');
}

/**
 * Catch-up at startup: the instance may have been offline for hours.
 * Offset by a few seconds so as not to compete with the service's startup, and spread across connections so as not to hammer the studio's site.
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
