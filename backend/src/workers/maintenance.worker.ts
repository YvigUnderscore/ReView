// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Worker } from 'bullmq';
import { redisConnectionOptions } from '../lib/redis';
import { QUEUE_NAMES, type MaintenanceJobData } from '../services/JobService';
import { logger } from '../lib/logger';
import { getNumericSetting, SETTING_KEYS } from '../lib/settings';
import { purgeExpiredTrash } from '../lib/trash';
import { purgeStaleUploads } from '../lib/staleUploads';
import { purgeObsoleteDerived } from '../lib/derivedPurge';
import { purgeIdempotencyRecords } from '../lib/idempotency';
import { sweepRetention } from '../lib/retention';
import { reconcileStuckMedia } from '../lib/mediaReconcile';
import { sendDailyDigests } from '../services/DigestService';
import { sendWeeklyReports } from '../services/WeeklyReportService';
import { registerWorkerShutdown } from './shutdown';

/**
 * Periodic maintenance — daily digest, weekly report, purges.
 *
 * These three appointments used to live in `setInterval`s of the API process (server.ts). They are now posted to a repeatable queue by the API (`lib/maintenanceSchedule`)
 * and executed here: same hours, same actions, but with the history, the retries and the visibility of the other jobs — and without the risk of a double send across two replicas.
 */

/**
 * Buffer purge: expired trash, obsolete derivatives, idempotency keys, then the retention sweep of the nine journal tables (`lib/retention`). These are buffers, not
 * archives: without a purge, they grow indefinitely at the studio's pace.
 *
 * The pass ends with the reconciliation of media frozen in `PROCESSING`: it is the only periodic appointment of the studio, and therefore the only place from which it can
 * recover a worker killed in the middle of a transcode without waiting for an API restart.
 *
 * Everything is capped per pass — trash as well as logs. A studio that enables retention after a year of operation catches up its backlog over several nights, without ever
 * blocking the database on the deletion of several million rows.
 */
async function runPurge(): Promise<void> {
  const days = await getNumericSetting(SETTING_KEYS.TRASH_RETENTION_DAYS);
  const purged = await purgeExpiredTrash(days);
  if (purged > 0) logger.info(`[Trash] purge automatique : ${purged} élément(s) supprimé(s) définitivement.`);
    // Purge of obsolete derivatives (37.H) — no-op if disabled in the admin.
  await purgeObsoleteDerived();
    // Abandoned uploads: without this pass, five accidents were enough to block an account.
  const uploads = await purgeStaleUploads();
  if (uploads.purged > 0)
    logger.info(`[Uploads] purge automatique : ${uploads.purged} envoi(s) abandonné(s) nettoyé(s).`);
  const keys = await purgeIdempotencyRecords();
  if (keys > 0) logger.info(`[API v1] purge : ${keys} clé(s) d'idempotence.`);
    // Logs its own result (and records it in the audit when it has deleted).
  await sweepRetention();
    // Media frozen in PROCESSING by a killed worker: the sweep lived in the startup of the API process, whereas the process that dies is the worker — `restart: always`
    // relaunches it alone, without touching the API, and the media kept its spinner indefinitely. Placed at the end of the pass: a reconciliation in error must not take
    // down the purges already done.
  const reconciled = await reconcileStuckMedia();
  if (reconciled > 0)
        // The count goes into a context field rather than into a template: a log is filtered on a field, and `check-untranslated` counts the template fragments.
    logger.info({ reconciled }, '[reconcile] médias figés en PROCESSING passés en échec');
}

export const maintenanceWorker = new Worker<MaintenanceJobData, void, string>(
  QUEUE_NAMES.MAINTENANCE,
  async (job) => {
    switch (job.data.kind) {
      case 'daily-digest': {
        const sent = await sendDailyDigests();
        logger.info({ sent }, '[maintenance] digest quotidien envoyé');
        return;
      }
      case 'weekly-report': {
        const sent = await sendWeeklyReports();
        logger.info({ sent }, '[maintenance] rapport hebdomadaire envoyé');
        return;
      }
      case 'purge':
        await runPurge();
        return;
      default:
        logger.warn({ data: job.data }, '[maintenance.worker] type de travail inconnu');
    }
  },
    // A single appointment at a time: these jobs sweep the database, parallelizing them would gain nothing and would compete with the transcodes.
  { connection: redisConnectionOptions, autorun: false, concurrency: 1 },
);

maintenanceWorker.on('failed', (job, err) =>
  logger.error({ err, kind: job?.data.kind }, '[maintenance.worker] ✗'),
);

export function startMaintenanceWorker(): void {
  void maintenanceWorker.run();
  registerWorkerShutdown('maintenance.worker', maintenanceWorker);
  logger.info('[maintenance.worker] démarré.');
}
