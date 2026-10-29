// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { prisma } from './prisma';
import { logger } from './logger';
import { AUDIT_RETENTION_MIN_DAYS, logAudit, purgeableAuditWhere } from '../services/AuditService';

/**
 * Log retention — lifecycle of the tables that never stop growing.
 *
 * Nine tables record activity without ever returning anything: audit, media access, notifications, sessions, password resets, invitations, sharing
 * links, ShotGrid sync passes and the API v1 event log. At the volume of a feature film (2,000 shots, 50 people, ~20,000 versions) they end up
 * weighing more than the production data itself — and they contain personal data (IP addresses, identities, timestamps) that no studio can keep
 * indefinitely without justification.
 *
 * Two guarantees are kept here:
 *  1. **one duration per family**, adjustable by administration, `0` = unlimited retention (same convention as `trash_retention_days`);
 *  2. **deletion by capped batches** — never a `DELETE` of several million rows that would lock the table while the studio works. Each pass has
 *     a budget; what exceeds it waits for the next pass.
 *
 * What is NEVER deleted, whatever the duration:
 *  - a session still valid (only those revoked/expired for N days leave);
 *  - an active sharing link (only those revoked/expired for N days leave);
 *  - a ShotGrid pass still carrying an unarbitrated conflict;
 *  - an audit entry describing an erasure (`AUDIT_UNPURGEABLE_ACTIONS`), and more generally the audit log within `AUDIT_RETENTION_MIN_DAYS` (A5-04):
 *    this is what prevents an administrator from erasing their own traces through the policy.
 *
 * Policy and default values: `DOCUMENTATION/admin-guide/data-retention.md`.
 */

/** Log families subject to retention, in the display order of the administration. */
export const RETENTION_FAMILIES = [
  'auditLog',
  'mediaAccessLog',
  'notification',
  'userSession',
  'passwordReset',
  'invitation',
  'shareLink',
  'shotgridSync',
  'apiEvent',
] as const;

export type RetentionFamily = (typeof RETENTION_FAMILIES)[number];

/** Durations in days (`0` = unlimited retention) + size of the deletion batches. */
export type RetentionPolicy = Record<RetentionFamily, number> & { batchSize: number };

/**
 * Default values. They answer a simple question: "how long does the studio need this trace?"
 *  - audit and media access: **1 year**, the duration a security audit or a rights holder asking who saw what requires;
 *  - notifications: **90 days**, the bell only shows the recent;
 *  - sessions / invitations / shares: the trace no longer serves once the object is dead;
 *  - password resets: **7 days**, a consumed token has no value left;
 *  - ShotGrid sync: **90 days**, enough to explain a divergence from the season;
 *  - API v1 events: **30 days**, the historical value of the `GET /api/v1/events` cursor.
 */
export const RETENTION_DEFAULTS: RetentionPolicy = {
  auditLog: 365,
  mediaAccessLog: 365,
  notification: 90,
  userSession: 30,
  passwordReset: 7,
  invitation: 90,
  shareLink: 180,
  shotgridSync: 90,
  apiEvent: 30,
  batchSize: 2000,
};

const RETENTION_KEY = 'retention_policy';

/** Ten years: beyond that, the duration no longer means anything — might as well write `0`. */
const MAX_DAYS = 3650;
const MIN_BATCH = 100;
const MAX_BATCH = 20_000;

/** Budget of an automatic pass: 200 batches × 2,000 rows = 400,000 rows per family. */
export const MAX_BATCHES_PER_FAMILY = 200;

/** Budget of a manual trigger: bounded so that the HTTP request answers. */
export const MANUAL_MAX_BATCHES = 10;

/** Breather between two batches: the database also serves the 50 people working. */
export const BATCH_PAUSE_MS = 25;

const clampDays = (value: unknown, fallback: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(Math.round(Number(value)), 0), MAX_DAYS) : fallback;

/**
 * Sanitised audit duration (A5-04): `0` remains unlimited retention, any finite duration is raised to the floor. This is not the first defence —
 * the schema already refuses the value — it is the second: a policy written before this floor, or a `Setting` row edited directly in the database,
 * must not shorten the purge for all that.
 *
 * The floor applies **only to a proposed value**, never to the fallback: the fallback is an already sanitised policy, and overwriting it would make
 * "absent value = value in place" a lie.
 */
const clampAuditDays = (value: unknown, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  const days = clampDays(value, fallback);
  return days === 0 ? 0 : Math.max(days, AUDIT_RETENTION_MIN_DAYS);
};

function sanitize(raw: unknown, base: RetentionPolicy): RetentionPolicy {
  const o = (raw ?? {}) as Partial<Record<keyof RetentionPolicy, unknown>>;
  const out = { ...base };
  for (const family of RETENTION_FAMILIES) out[family] = clampDays(o[family], base[family]);
  out.auditLog = clampAuditDays(o.auditLog, base.auditLog);
  out.batchSize = Number.isFinite(o.batchSize)
    ? Math.min(Math.max(Math.round(Number(o.batchSize)), MIN_BATCH), MAX_BATCH)
    : base.batchSize;
  return out;
}

const daysField = z.number().int().min(0).max(MAX_DAYS).optional();

/**
 * Audit duration: `0` (unlimited) or at least `AUDIT_RETENTION_MIN_DAYS`. Refusal is preferable to silent adjustment — an administrator who asks for
 * "one day" must learn that the answer is no, rather than leave believing their traces will be erasable tomorrow.
 */
const auditDaysField = z
  .union([z.literal(0), z.number().int().min(AUDIT_RETENTION_MIN_DAYS).max(MAX_DAYS)])
  .optional();

export const retentionPolicySchema = z.object({
  auditLog: auditDaysField,
  mediaAccessLog: daysField,
  notification: daysField,
  userSession: daysField,
  passwordReset: daysField,
  invitation: daysField,
  shareLink: daysField,
  shotgridSync: daysField,
  apiEvent: daysField,
  batchSize: z.number().int().min(MIN_BATCH).max(MAX_BATCH).optional(),
});

export async function getRetentionPolicy(): Promise<RetentionPolicy> {
  const row = await prisma.setting.findUnique({ where: { key: RETENTION_KEY } });
  if (!row) return { ...RETENTION_DEFAULTS };
  try {
    return sanitize(JSON.parse(row.value), RETENTION_DEFAULTS);
  } catch {
    return { ...RETENTION_DEFAULTS };
  }
}

export async function setRetentionPolicy(value: unknown): Promise<RetentionPolicy> {
  const clean = sanitize(value, await getRetentionPolicy());
  const serialized = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: RETENTION_KEY },
    update: { value: serialized },
    create: { key: RETENTION_KEY, value: serialized },
  });
  return clean;
}

// ── Batched deletion ──

/** Row identifier: an integer everywhere, except `UserSession` whose `sid` is a string. */
type RowId = number | string;

export interface BatchDeleter {
  /** At most `take` identifiers of expired rows, the oldest first. */
  findExpiredIds(cutoff: Date, take: number): Promise<RowId[]>;
  deleteByIds(ids: RowId[]): Promise<number>;
}

export interface BatchBudget {
  batchSize: number;
  maxBatches: number;
  pauseMs?: number;
  /** Injectable for tests — otherwise `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deletes expired rows by batches. Stops dead at the batch ceiling, signalling `truncated`: the rest goes to the next pass, the database is never
 * blocked by a massive deletion.
 */
export async function deleteInBatches(
  deleter: BatchDeleter,
  cutoff: Date,
  budget: BatchBudget,
): Promise<{ deleted: number; truncated: boolean }> {
  const sleep = budget.sleep ?? defaultSleep;
  const pauseMs = budget.pauseMs ?? 0;
  let deleted = 0;

  for (let batch = 0; batch < budget.maxBatches; batch += 1) {
    const ids = await deleter.findExpiredIds(cutoff, budget.batchSize);
    if (ids.length === 0) return { deleted, truncated: false };
    deleted += await deleter.deleteByIds(ids);
    // An incomplete batch = nothing left to take: no need to query the database once more.
    if (ids.length < budget.batchSize) return { deleted, truncated: false };
    // A breather between two batches — not after the last one; we hand control back straight away.
    if (pauseMs > 0 && batch + 1 < budget.maxBatches) await sleep(pauseMs);
  }
  return { deleted, truncated: true };
}

// ── One family = one pair (selection of the expired, deletion) ──

interface FamilySpec extends BatchDeleter {
  /**
   * Batch divider: a cascading deletion carries far more rows than it targets (a ShotGrid pass carries up to 2,000 log lines).
   */
  batchDivisor: number;
}

const pickIds = (rows: { id: RowId }[]): RowId[] => rows.map((r) => r.id);

/**
 * Ascending sort by identifier: the primary key is a counter, so the smallest identifiers are the oldest rows — those the purge is looking for.
 * Postgres reads the primary index from the start and stops as soon as the batch is full.
 */
const OLDEST_FIRST = { id: 'asc' } as const;

const SPECS: Record<RetentionFamily, FamilySpec> = {
  // A5-04: the filter comes from `AuditService`, which exempts the actions describing an erasure — purging yesterday's `RETENTION_CONFIG` is erasing
  // the proof of the erasure, and that is exactly the gesture the attacker is looking for.
  auditLog: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.auditLog
        .findMany({ where: purgeableAuditWhere(cutoff), select: { id: true }, orderBy: OLDEST_FIRST, take })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.auditLog.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  mediaAccessLog: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.mediaAccessLog
        .findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, orderBy: OLDEST_FIRST, take })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.mediaAccessLog.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  notification: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.notification
        .findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, orderBy: OLDEST_FIRST, take })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.notification.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  // Never a live session: `expiresAt`/`revokedAt` are in the past of the cut-off.
  userSession: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.userSession
        .findMany({
          where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take,
        })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.userSession.deleteMany({ where: { id: { in: ids as string[] } } }).then((r) => r.count),
  },
  // Token consumed or stale for longer than the duration: it no longer opens anything.
  passwordReset: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.passwordReset
        .findMany({
          where: { OR: [{ used: true, createdAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
          select: { id: true },
          orderBy: OLDEST_FIRST,
          take,
        })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.passwordReset.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  // An accepted or stale invitation no longer serves: the account exists, or a new invitation is needed.
  invitation: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.invitation
        .findMany({
          where: { OR: [{ acceptedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
          select: { id: true },
          orderBy: OLDEST_FIRST,
          take,
        })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.invitation.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  // A link without expiry and not revoked remains active: it is never concerned.
  shareLink: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.shareLink
        .findMany({
          where: { OR: [{ revoked: true, createdAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
          select: { id: true },
          orderBy: OLDEST_FIRST,
          take,
        })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.shareLink.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  // The pass carries its log lines (cascade) — unless a conflict awaits its arbitration.
  shotgridSync: {
    batchDivisor: 10,
    findExpiredIds: (cutoff, take) =>
      prisma.shotgridSyncRun
        .findMany({
          where: {
            finishedAt: { lt: cutoff },
            logs: { none: { level: 'conflict', resolvedAt: null } },
          },
          select: { id: true },
          orderBy: OLDEST_FIRST,
          take,
        })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.shotgridSyncRun.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
  apiEvent: {
    batchDivisor: 1,
    findExpiredIds: (cutoff, take) =>
      prisma.apiEvent
        .findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, orderBy: OLDEST_FIRST, take })
        .then(pickIds),
    deleteByIds: (ids) =>
      prisma.apiEvent.deleteMany({ where: { id: { in: ids as number[] } } }).then((r) => r.count),
  },
};

export interface SweepResult {
  /** Rows deleted per family (0 for a family under unlimited retention). */
  families: Record<RetentionFamily, number>;
  total: number;
  /** True if at least one family reached its ceiling: the next pass will continue. */
  truncated: boolean;
}

export interface SweepOptions {
  policy?: RetentionPolicy;
  maxBatches?: number;
  now?: Date;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Sweeps all the families. A family in failure (locked table, migration in progress) is logged and does not prevent the others from running — a local
 * incident must not freeze the whole data lifecycle.
 */
export async function sweepRetention(options: SweepOptions = {}): Promise<SweepResult> {
  const policy = options.policy ?? (await getRetentionPolicy());
  const now = options.now ?? new Date();
  const maxBatches = options.maxBatches ?? MAX_BATCHES_PER_FAMILY;
  const families = Object.fromEntries(RETENTION_FAMILIES.map((f) => [f, 0])) as Record<
    RetentionFamily,
    number
  >;
  let total = 0;
  let truncated = false;

  for (const family of RETENTION_FAMILIES) {
    const days = policy[family];
    if (days <= 0) continue; // 0 = unlimited retention, decided by the administration
    const spec = SPECS[family];
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const batchSize = Math.max(MIN_BATCH, Math.floor(policy.batchSize / spec.batchDivisor));
    try {
      const result = await deleteInBatches(spec, cutoff, {
        batchSize,
        maxBatches,
        pauseMs: options.pauseMs ?? BATCH_PAUSE_MS,
        sleep: options.sleep,
      });
      families[family] = result.deleted;
      total += result.deleted;
      truncated = truncated || result.truncated;
    } catch (err) {
      logger.error({ err, family }, '[retention] sweep interrupted for this family');
    }
  }

  if (total > 0) {
    logger.info({ families, truncated }, '[retention] sweep done');
    // Trace viewable in the audit screen: a studio must be able to show WHEN it purges.
    logAudit({ action: 'RETENTION_SWEEP', entityType: 'Setting', metadata: { families, truncated } });
  }
  return { families, total, truncated };
}

export const __testing = { sanitize, RETENTION_KEY };
