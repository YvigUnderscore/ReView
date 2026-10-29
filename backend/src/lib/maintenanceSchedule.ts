// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from './logger';
import { maintenanceQueue } from '../services/JobService';

/**
 * Maintenance rhythm: daily digest, weekly report, purges.
 *
 * These three appointments used to be `setInterval` timers in the API process. Held in process memory, they vanished
 * at each restart (a deployment at 6:59 would skip the 7:00 digest), would duplicate on a second replica, and left no
 * trace of their execution. Posted as repeatable queue jobs — the pattern of `ShotgridSchedule` — they survive a
 * restart, fire only once whatever the number of replicas, and show in the queue dashboard like any other job.
 *
 * The functional behaviour is unchanged: same hours, same actions.
 */

/** Stable identifiers: re-posting the schedule replaces, it does not stack. */
export const MAINTENANCE_JOB_IDS = {
  dailyDigest: 'maintenance-daily-digest',
  weeklyReport: 'maintenance-weekly-report',
  purge: 'maintenance-purge',
  purgeBoot: 'maintenance-purge-boot',
} as const;

/** Repeatable job names managed by this schedule (the others are left untouched). */
const SCHEDULED_NAMES = new Set(['daily-digest', 'weekly-report', 'purge']);

/** Daily purge — the former 24 h `setInterval`. */
export const PURGE_EVERY_MS = 24 * 60 * 60 * 1000;

/** First deferred purge run, like the former start-up `setTimeout`. */
export const PURGE_BOOT_DELAY_MS = 60_000;

/** Valid hour (0-23) — an aberrant value must not produce an invalid cron pattern. */
export function normalizeHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  return Math.min(23, Math.max(0, Math.trunc(hour)));
}

/** Daily digest: every day at `hour`, like the former first `setTimeout` + 24 h. */
export function dailyDigestPattern(hour: number): string {
  return `0 ${normalizeHour(hour)} * * *`;
}

/** Weekly report: on Monday at `hour` (`1` = Monday, as in `Date#getDay`). */
export function weeklyReportPattern(hour: number): string {
  return `0 ${normalizeHour(hour)} * * 1`;
}

/**
 * (Re)posts the three periodic jobs. Called at API process start-up: it is the one that carries `DIGEST_HOUR`.
 * Idempotent — the former repeatables managed here are removed first, otherwise a change of hour would leave both
 * schedules active.
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

  // A purge run shortly after start-up, as the 60 s `setTimeout` did: an instance restarted after a long outage must
  // not wait until tomorrow to empty an expired trash. Purges are idempotent.
  // The identifier is stable but the job is erased as soon as it completes: two close restarts run only one purge, and
  // the next one can arm it again.
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
