// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from './logger';
import { maintenanceQueue } from '../services/JobService';

/**
 * Rythme de l'entretien : digest quotidien, rapport hebdomadaire, purges.
 *
 * Ces trois rendez-vous étaient des `setInterval` du process API. En mémoire de process,
 * ils disparaissaient à chaque redémarrage (un déploiement à 6 h 59 escamotait le digest
 * de 7 h), se dupliqueraient sur une seconde réplique, et ne laissaient aucune trace de
 * leur exécution. Posés en file répétable — le motif de `ShotgridSchedule` — ils
 * survivent au redémarrage, ne partent qu'une fois quel que soit le nombre de répliques,
 * et apparaissent dans le tableau de bord des files comme n'importe quel autre travail.
 *
 * Le comportement fonctionnel est inchangé : mêmes heures, mêmes actions.
 */

/** Identifiants stables : reposer le planning remplace, il n'empile pas. */
export const MAINTENANCE_JOB_IDS = {
  dailyDigest: 'maintenance-daily-digest',
  weeklyReport: 'maintenance-weekly-report',
  purge: 'maintenance-purge',
  purgeBoot: 'maintenance-purge-boot',
} as const;

/** Noms de job répétables gérés par ce planning (les autres sont laissés intacts). */
const SCHEDULED_NAMES = new Set(['daily-digest', 'weekly-report', 'purge']);

/** Purge quotidienne — l'ancien `setInterval` de 24 h. */
export const PURGE_EVERY_MS = 24 * 60 * 60 * 1000;

/** Premier passage de purge différé, comme l'ancien `setTimeout` de démarrage. */
export const PURGE_BOOT_DELAY_MS = 60_000;

/** Heure valide (0-23) — une valeur aberrante ne doit pas produire un motif cron invalide. */
export function normalizeHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  return Math.min(23, Math.max(0, Math.trunc(hour)));
}

/** Digest quotidien : tous les jours à `hour`, comme l'ancien premier `setTimeout` + 24 h. */
export function dailyDigestPattern(hour: number): string {
  return `0 ${normalizeHour(hour)} * * *`;
}

/** Rapport hebdomadaire : le lundi à `hour` (`1` = lundi, comme `Date#getDay`). */
export function weeklyReportPattern(hour: number): string {
  return `0 ${normalizeHour(hour)} * * 1`;
}

/**
 * (Re)pose les trois travaux périodiques. Appelée au démarrage du process API : c'est lui
 * qui porte `DIGEST_HOUR`. Idempotente — les anciens répétables gérés ici sont retirés
 * avant, sans quoi un changement d'heure laisserait les deux plannings actifs.
 */
export async function scheduleMaintenanceJobs(digestHour: number): Promise<void> {
  const repeatables = await maintenanceQueue.getRepeatableJobs();
  for (const job of repeatables) {
    if (SCHEDULED_NAMES.has(job.name)) await maintenanceQueue.removeRepeatableByKey(job.key);
  }

  await maintenanceQueue.add(
    'daily-digest',
    { kind: 'daily-digest' },
    {
      repeat: { pattern: dailyDigestPattern(digestHour) },
      jobId: MAINTENANCE_JOB_IDS.dailyDigest,
      removeOnComplete: 20,
    },
  );

  await maintenanceQueue.add(
    'weekly-report',
    { kind: 'weekly-report' },
    {
      repeat: { pattern: weeklyReportPattern(digestHour) },
      jobId: MAINTENANCE_JOB_IDS.weeklyReport,
      removeOnComplete: 20,
    },
  );

  await maintenanceQueue.add(
    'purge',
    { kind: 'purge' },
    {
      repeat: { every: PURGE_EVERY_MS },
      jobId: MAINTENANCE_JOB_IDS.purge,
      removeOnComplete: 20,
    },
  );

  // Passage de purge peu après le démarrage, comme le faisait le `setTimeout` de 60 s :
  // une instance rallumée après une longue coupure ne doit pas attendre demain pour
  // vider une corbeille expirée. Les purges sont idempotentes.
  // L'identifiant est stable mais le job s'efface aussitôt terminé : deux redémarrages
  // rapprochés ne lancent qu'une purge, et le suivant peut de nouveau l'armer.
  await maintenanceQueue.add(
    'purge',
    { kind: 'purge' },
    {
      delay: PURGE_BOOT_DELAY_MS,
      jobId: MAINTENANCE_JOB_IDS.purgeBoot,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );

  logger.info(
    { digestHour: normalizeHour(digestHour) },
    '[maintenance] travaux périodiques posés (digest, rapport hebdomadaire, purge)',
  );
}
