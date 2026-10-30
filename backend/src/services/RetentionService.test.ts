// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// No real database: each Prisma delegate touched by retention is simulated.
vi.mock('../lib/prisma', () => {
  const delegate = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  });
  return {
    prisma: {
      setting: { findUnique: vi.fn(), upsert: vi.fn() },
      auditLog: delegate(),
      mediaAccessLog: delegate(),
      notification: delegate(),
      userSession: delegate(),
      passwordReset: delegate(),
      invitation: delegate(),
      shareLink: delegate(),
      shotgridSyncRun: delegate(),
      apiEvent: delegate(),
    },
  };
});
vi.mock('../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// Only the audit write is simulated: the guards that retention borrows from it (floor, non-purgeable actions) must be the real ones,
// otherwise the test merely verifies its own copy.
vi.mock('./AuditService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./AuditService')>()),
  logAudit: vi.fn(),
}));

import {
  RETENTION_DEFAULTS,
  RETENTION_FAMILIES,
  deleteInBatches,
  getRetentionPolicy,
  retentionPolicySchema,
  setRetentionPolicy,
  sweepRetention,
  __testing,
  type RetentionPolicy,
} from './RetentionService';
import { prisma } from '../lib/prisma';
import { logAudit, AUDIT_RETENTION_MIN_DAYS, AUDIT_UNPURGEABLE_ACTIONS } from './AuditService';

const DAY = 86_400_000;

/** Policy where only the family passed as argument is active. */
function onlyFamily(family: keyof RetentionPolicy, days: number): RetentionPolicy {
  const policy = { ...RETENTION_DEFAULTS };
  for (const f of RETENTION_FAMILIES) policy[f] = 0;
  policy[family] = days;
  return policy;
}

beforeEach(() => vi.clearAllMocks());

/** Arguments of the first simulated call: Prisma's generic types are of no use here. */
function firstCall<T>(fn: unknown): T {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as T;
}

describe('retention.sanitize', () => {
  const { sanitize } = __testing;

  it('bounds each duration to [0, 3650] days and rounds', () => {
    const out = sanitize({ auditLog: -5, mediaAccessLog: 99_999, notification: 12.6 }, RETENTION_DEFAULTS);
    expect(out.auditLog).toBe(0);
    expect(out.mediaAccessLog).toBe(3650);
    expect(out.notification).toBe(13);
  });

  it('bounds the batch size to [100, 20000]', () => {
    expect(sanitize({ batchSize: 1 }, RETENTION_DEFAULTS).batchSize).toBe(100);
    expect(sanitize({ batchSize: 1e9 }, RETENTION_DEFAULTS).batchSize).toBe(20_000);
  });

  it('an absent or unreadable value keeps the value in place, not 0', () => {
    const base = { ...RETENTION_DEFAULTS, auditLog: 42 };
    expect(sanitize({}, base)).toEqual(base);
    expect(sanitize({ auditLog: 'beaucoup' }, base).auditLog).toBe(42);
  });
});

describe('reading / writing the policy', () => {
  it('without a saved setting, returns the default values', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue(null);
    await expect(getRetentionPolicy()).resolves.toEqual(RETENTION_DEFAULTS);
  });

  it('an unreadable setting does not bring the purge down: falls back on the defaults', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue({ value: '{oops' } as never);
    await expect(getRetentionPolicy()).resolves.toEqual(RETENTION_DEFAULTS);
  });

  it('writes a sanitised policy (out-of-bound values are never persisted)', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.setting.upsert).mockResolvedValue({} as never);

    const saved = await setRetentionPolicy({ auditLog: 99_999, notification: 30 });

    expect(saved.auditLog).toBe(3650);
    expect(saved.notification).toBe(30);
    const call = firstCall<{ where: { key: string }; create: { value: string } }>(prisma.setting.upsert);
    // The persisted key is a contract: renaming it would lose the studio's policy.
    expect(call.where.key).toBe(__testing.RETENTION_KEY);
    expect(__testing.RETENTION_KEY).toBe('retention_policy');
    expect(JSON.parse(call.create.value)).toEqual(saved);
  });
});

/**
 * A5-04: without a floor, `PUT /api/admin/retention {"auditLog":1}` followed by `POST /api/admin/retention/run` erased, in two gestures, the traces
 * of the person doing it. The floor refuses the duration instead of silently adjusting it — an administrator who asks for "one day" must learn that
 * the answer is no, not believe it is done.
 */
describe('minimum retention of the audit log (A5-04)', () => {
  it('refuses an audit duration below the floor, accepts 0 and the floor itself', () => {
    expect(retentionPolicySchema.safeParse({ auditLog: 1 }).success).toBe(false);
    expect(retentionPolicySchema.safeParse({ auditLog: AUDIT_RETENTION_MIN_DAYS - 1 }).success).toBe(false);
    // 0 = unlimited retention: that is the most protective meaning, it remains allowed.
    expect(retentionPolicySchema.safeParse({ auditLog: 0 }).success).toBe(true);
    expect(retentionPolicySchema.safeParse({ auditLog: AUDIT_RETENTION_MIN_DAYS }).success).toBe(true);
    // The floor applies only to the audit: the other families keep their freedom.
    expect(retentionPolicySchema.safeParse({ notification: 1 }).success).toBe(true);
  });

  it('raises an audit duration already persisted below the floor (earlier setting, or edited database)', async () => {
    vi.mocked(prisma.setting.findUnique).mockResolvedValue({ value: '{"auditLog":1}' } as never);
    await expect(getRetentionPolicy()).resolves.toMatchObject({ auditLog: AUDIT_RETENTION_MIN_DAYS });
  });

  it('lets 0 through and does not overwrite the value in place when nothing is proposed', () => {
    const base = { ...RETENTION_DEFAULTS, auditLog: 120 };
    expect(__testing.sanitize({ auditLog: 0 }, base).auditLog).toBe(0);
    expect(__testing.sanitize({}, base).auditLog).toBe(120);
  });
});

describe('deleteInBatches — deletion by capped batches', () => {
  it('stops as soon as a batch is incomplete and does not re-query the database', async () => {
    const findExpiredIds = vi.fn().mockResolvedValueOnce([1, 2]);
    const deleteByIds = vi.fn().mockResolvedValue(2);

    const out = await deleteInBatches({ findExpiredIds, deleteByIds }, new Date(), {
      batchSize: 10,
      maxBatches: 5,
    });

    expect(out).toEqual({ deleted: 2, truncated: false });
    expect(findExpiredIds).toHaveBeenCalledTimes(1);
  });

  it('chains the full batches and reports the truncation at the ceiling', async () => {
    const full = [1, 2];
    const findExpiredIds = vi.fn().mockResolvedValue(full);
    const deleteByIds = vi.fn().mockResolvedValue(2);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const out = await deleteInBatches({ findExpiredIds, deleteByIds }, new Date(), {
      batchSize: 2,
      maxBatches: 3,
      pauseMs: 25,
      sleep,
    });

    expect(out).toEqual({ deleted: 6, truncated: true });
    expect(findExpiredIds).toHaveBeenCalledTimes(3);
    // A breather between two batches — not after the last one.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(25);
  });

  it('table already empty: no deletion', async () => {
    const deleteByIds = vi.fn();
    const out = await deleteInBatches(
      { findExpiredIds: vi.fn().mockResolvedValue([]), deleteByIds },
      new Date(),
      { batchSize: 10, maxBatches: 5 },
    );
    expect(out).toEqual({ deleted: 0, truncated: false });
    expect(deleteByIds).not.toHaveBeenCalled();
  });
});

describe('sweepRetention', () => {
  const now = new Date('2026-08-22T03:00:00.000Z');

  it('does not touch a family set to 0 (unlimited retention)', async () => {
    await sweepRetention({ policy: onlyFamily('auditLog', 10), now, pauseMs: 0 });

    expect(prisma.notification.findMany).not.toHaveBeenCalled();
    expect(prisma.mediaAccessLog.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1);
  });

  it('computes the cut-off at N days and reports the total deleted', async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([{ id: 1 }, { id: 2 }] as never);
    vi.mocked(prisma.auditLog.deleteMany).mockResolvedValueOnce({ count: 2 });

    const out = await sweepRetention({ policy: onlyFamily('auditLog', 10), now, pauseMs: 0 });

    const args = firstCall<{ where: { createdAt: { lt: Date } } }>(prisma.auditLog.findMany);
    expect(args.where.createdAt.lt.getTime()).toBe(now.getTime() - 10 * DAY);
    expect(firstCall(prisma.auditLog.deleteMany)).toEqual({ where: { id: { in: [1, 2] } } });
    expect(out.total).toBe(2);
    expect(out.families.auditLog).toBe(2);
    expect(out.truncated).toBe(false);
  });

  /**
   * A5-04: the audit purge must never carry away the proof of erasure. Without this exclusion, the `RETENTION_CONFIG` that betrays the manoeuvre
   * would leave with the rest.
   */
  it('unconditionally spares the actions that describe an erasure', async () => {
    await sweepRetention({ policy: onlyFamily('auditLog', 100), now, pauseMs: 0 });

    const args = firstCall<{ where: { action?: { notIn: string[] } } }>(prisma.auditLog.findMany);
    expect(args.where.action?.notIn).toEqual(AUDIT_UNPURGEABLE_ACTIONS);
    expect(AUDIT_UNPURGEABLE_ACTIONS).toContain('RETENTION_CONFIG');
  });

  it('records an audit trace when it has deleted, and nothing when the database is clean', async () => {
    await sweepRetention({ policy: onlyFamily('auditLog', 10), now, pauseMs: 0 });
    expect(logAudit).not.toHaveBeenCalled();

    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([{ id: 7 }] as never);
    vi.mocked(prisma.auditLog.deleteMany).mockResolvedValueOnce({ count: 1 });
    await sweepRetention({ policy: onlyFamily('auditLog', 10), now, pauseMs: 0 });

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RETENTION_SWEEP', entityType: 'Setting' }),
    );
  });

  it('a family in failure does not prevent the following ones from running', async () => {
    const policy = { ...RETENTION_DEFAULTS };
    for (const f of RETENTION_FAMILIES) policy[f] = 0;
    policy.auditLog = 10;
    policy.apiEvent = 10;
    vi.mocked(prisma.auditLog.findMany).mockRejectedValueOnce(new Error('table verrouillée'));
    vi.mocked(prisma.apiEvent.findMany).mockResolvedValueOnce([{ id: 3 }] as never);
    vi.mocked(prisma.apiEvent.deleteMany).mockResolvedValueOnce({ count: 1 });

    const out = await sweepRetention({ policy, now, pauseMs: 0 });

    expect(out.families.auditLog).toBe(0);
    expect(out.families.apiEvent).toBe(1);
    expect(out.total).toBe(1);
  });

  it('sessions: targets only those dead before the cut-off, never a live session', async () => {
    await sweepRetention({ policy: onlyFamily('userSession', 30), now, pauseMs: 0 });

    const args = firstCall<{ where: { OR: Record<string, { lt: Date }>[] } }>(prisma.userSession.findMany);
    const cutoff = now.getTime() - 30 * DAY;
    expect(args.where.OR).toHaveLength(2);
    expect(args.where.OR[0]!.revokedAt!.lt.getTime()).toBe(cutoff);
    expect(args.where.OR[1]!.expiresAt!.lt.getTime()).toBe(cutoff);
  });

  it('sharing links: an active link without expiry is never targeted', async () => {
    await sweepRetention({ policy: onlyFamily('shareLink', 180), now, pauseMs: 0 });

    const args = firstCall<{ where: { OR: Record<string, unknown>[] } }>(prisma.shareLink.findMany);
    expect(args.where.OR[0]).toMatchObject({ revoked: true });
    expect(args.where.OR[1]).toHaveProperty('expiresAt');
  });

  it('ShotGrid: a pass carrying an unarbitrated conflict is spared', async () => {
    await sweepRetention({ policy: onlyFamily('shotgridSync', 90), now, pauseMs: 0 });

    const args = firstCall<{ where: { logs: { none: unknown } }; take: number }>(
      prisma.shotgridSyncRun.findMany,
    );
    expect(args.where.logs.none).toEqual({ level: 'conflict', resolvedAt: null });
    // Reduced batch: deleting a pass takes its log lines with it by cascade.
    expect(args.take).toBe(RETENTION_DEFAULTS.batchSize / 10);
  });
});
