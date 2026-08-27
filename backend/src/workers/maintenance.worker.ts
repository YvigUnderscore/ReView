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
import { sendDailyDigests } from '../services/DigestService';
import { sendWeeklyReports } from '../services/WeeklyReportService';
import { registerWorkerShutdown } from './shutdown';

/**
 * Entretien périodique — digest quotidien, rapport hebdomadaire, purges.
 *
 * Ces trois rendez-vous vivaient dans des `setInterval` du process API (server.ts). Ils
 * sont désormais posés en file répétable par l'API (`lib/maintenanceSchedule`) et
 * exécutés ici : mêmes heures, mêmes actions, mais avec l'historique, les reprises et la
 * visibilité des autres travaux — et sans risque de double envoi sur deux répliques.
 */

/**
 * Purge des tampons : corbeille expirée, dérivés obsolètes, clés d'idempotence, puis
 * balayage de rétention des neuf tables de journal (`lib/retention`). Ce sont des tampons,
 * pas des archives : sans purge, ils grossissent indéfiniment au rythme du studio.
 *
 * Tout est plafonné par passe — corbeille comme journaux. Un studio qui active la rétention
 * après un an d'exploitation rattrape son retard en plusieurs nuits, sans jamais bloquer la
 * base sur une suppression de plusieurs millions de lignes.
 */
async function runPurge(): Promise<void> {
  const days = await getNumericSetting(SETTING_KEYS.TRASH_RETENTION_DAYS);
  const purged = await purgeExpiredTrash(days);
  if (purged > 0) logger.info(`[Trash] purge automatique : ${purged} élément(s) supprimé(s) définitivement.`);
  // Purge des dérivés obsolètes (37.H) — no-op si désactivée dans l'admin.
  await purgeObsoleteDerived();
  // Envois abandonnés : sans ce passage, cinq accidents suffisaient à bloquer un compte.
  const uploads = await purgeStaleUploads();
  if (uploads.purged > 0)
    logger.info(`[Uploads] purge automatique : ${uploads.purged} envoi(s) abandonné(s) nettoyé(s).`);
  const keys = await purgeIdempotencyRecords();
  if (keys > 0) logger.info(`[API v1] purge : ${keys} clé(s) d'idempotence.`);
  // Journalise lui-même son résultat (et le consigne dans l'audit quand il a supprimé).
  await sweepRetention();
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
  // Un seul entretien à la fois : ces travaux balayent la base, les paralléliser ne
  // gagnerait rien et concurrencerait les transcodages.
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
