// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The audit log is only worth something through what can be read back from it, and through what cannot be
 * erased from it. These tests pin the three corresponding properties:
 *
 * - `list` returns `metadata` (it was stripped from the response: "MEDIA_PURGE · 812" without saying which
 *   of the three hundred identifiers in the batch had gone);
 * - it returns it **redacted**: the path of a webhook URL is a secret, not audit data;
 * - `logAudit` duplicates the database write as an emission to the pino log, out of reach of the retention
 *   policy.
 */

const { prismaMock, loggerMock, avatarUrlMock } = vi.hoisted(() => ({
  prismaMock: {
    auditLog: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  },
  loggerMock: { info: vi.fn(), warn: vi.fn() },
  avatarUrlMock: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../lib/logger', () => ({ logger: loggerMock }));
vi.mock('../lib/userView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/userView')>();
  return { ...actual, avatarUrl: avatarUrlMock };
});

import {
  list,
  logAudit,
  logLoginAttempt,
  redactAuditMetadata,
  purgeableAuditWhere,
  AUDIT_RETENTION_MIN_DAYS,
  AUDIT_UNPURGEABLE_ACTIONS,
} from './AuditService';

const page = { page: 1, pageSize: 20, order: 'desc' as const, cursor: undefined, sort: undefined };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.auditLog.count.mockResolvedValue(1);
  prismaMock.auditLog.create.mockReturnValue({ catch: vi.fn() });
});

describe('AuditService.list: metadata output (A5-03)', () => {
  it('returns the metadata of each row', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: 7,
        userId: 3,
        action: 'MEDIA_PURGE',
        entityType: 'MediaObject',
        entityId: 812,
        createdAt: new Date('2026-09-16T10:00:00Z'),
        metadata: { ids: [812, 813, 814] },
        user: null,
      },
    ]);
    const res = (await list(page)) as { items: { metadata: unknown }[] };
    expect(res.items[0]!.metadata).toEqual({ ids: [812, 813, 814] });
  });

  it("exposes neither a webhook token nor a secret by name", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: 8,
        userId: 3,
        action: 'WEBHOOK_CREATE',
        entityType: 'Webhook',
        entityId: 1,
        createdAt: new Date('2026-09-16T10:00:00Z'),
        metadata: {
          url: 'https://discord.com/api/webhooks/123/SUPER-SECRET',
          webhookSecret: 'hmac-key',
          events: ['media.created'],
        },
        user: null,
      },
    ]);
    const res = (await list(page)) as { items: { metadata: Record<string, unknown> }[] };
    const meta = res.items[0]!.metadata;
    expect(meta.url).toBe('https://discord.com/…');
    expect(meta.webhookSecret).toBe('[Redacted]');
    expect(meta.events).toEqual(['media.created']);
    expect(JSON.stringify(meta)).not.toContain('SUPER-SECRET');
    expect(JSON.stringify(meta)).not.toContain('hmac-key');
  });

  it('never returns a raw userId nor a full user object', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: 9,
        userId: 3,
        action: 'LOGIN',
        entityType: 'User',
        entityId: 3,
        createdAt: new Date(),
        metadata: {},
        user: {
          id: 3,
          email: 'a@b.c',
          name: 'Ana',
          firstName: null,
          lastName: null,
          username: null,
          avatarKey: null,
        },
      },
    ]);
    const res = (await list(page)) as { items: Record<string, unknown>[] };
    expect(res.items[0]).not.toHaveProperty('userId');
    expect(res.items[0]!.user).toMatchObject({ id: 3, displayName: 'Ana' });
  });
});

describe('redactAuditMetadata: redact rather than omit', () => {
  it('lets numbers, booleans, null and ordinary strings through', () => {
    expect(redactAuditMetadata({ count: 3, ok: true, none: null, name: 'Seq 010' })).toEqual({
      count: 3,
      ok: true,
      none: null,
      name: 'Seq 010',
    });
  });

  it('reduces a URL to its origin, but leaves a homonymous settings key intact', () => {
    expect(redactAuditMetadata({ url: 'https://hooks.slack.com/services/T/B/XYZ' })).toEqual({
      url: 'https://hooks.slack.com/…',
    });
    // `key` is the NAME of the setting, not a target: nothing to redact.
    expect(redactAuditMetadata({ key: 'slack_webhook_url' })).toEqual({ key: 'slack_webhook_url' });
  });

  it('bounds lists, strings and depth', () => {
    const many = Array.from({ length: 120 }, (_, i) => i);
    const redacted = redactAuditMetadata({ ids: many }) as { ids: unknown[] };
    expect(redacted.ids).toHaveLength(51);
    expect(redacted.ids[50]).toBe('… +70');

    const long = redactAuditMetadata({ label: 'x'.repeat(400) }) as { label: string };
    expect(long.label).toHaveLength(257);

    const deep = redactAuditMetadata({ a: { b: { c: { d: { e: 1 } } } } }) as Record<string, never>;
    expect(JSON.stringify(deep)).toContain('[Redacted]');
  });

  it('redacts a secret at any depth', () => {
    expect(redactAuditMetadata({ smtp: { host: 'mail.test', password: 'hunter2' } })).toEqual({
      smtp: { host: 'mail.test', password: '[Redacted]' },
    });
  });
});

describe('logAudit: copy out of reach of retention (A5-04)', () => {
  it('emits the row to the pino log in addition to the database', () => {
    logAudit({ userId: 1, action: 'RETENTION_CONFIG', entityType: 'Setting', metadata: { auditLog: 1 } });
    expect(prismaMock.auditLog.create).toHaveBeenCalledOnce();
    expect(loggerMock.info).toHaveBeenCalledWith(
      { audit: expect.objectContaining({ action: 'RETENTION_CONFIG', metadata: { auditLog: 1 } }) },
      '[audit]',
    );
  });

  it('also redacts the logged copy', () => {
    logAudit({
      userId: 1,
      action: 'WEBHOOK_CREATE',
      metadata: { url: 'https://discord.com/api/webhooks/1/TOK' },
    });
    expect(JSON.stringify(loggerMock.info.mock.calls[0])).not.toContain('TOK');
  });

  it('writes the raw metadata to the database: redaction only applies to output', () => {
    logAudit({ userId: 1, action: 'SHARE_UNLOCK_FAIL', metadata: { ip: '10.1.2.3' } });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: { ip: '10.1.2.3' } }),
    });
  });
});

describe('logLoginAttempt: login leaves a trace (A5-03)', () => {
  it('records LOGIN with the author when access is granted', () => {
    logLoginAttempt({ user: { id: 7 }, granted: true, email: 'alice@studio.com', ip: '10.1.2.3' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 7,
        action: 'LOGIN',
        entityType: 'User',
        entityId: 7,
        metadata: { email: 'alice@studio.com', ip: '10.1.2.3' },
      },
    });
  });

  it('records LOGIN_FAIL without an author when the address matches no account', () => {
    logLoginAttempt({ user: null, granted: false, email: 'fantome@studio.com' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        action: 'LOGIN_FAIL',
        entityType: 'User',
        entityId: null,
        // The targeted address is the datum that makes enumeration visible.
        metadata: { email: 'fantome@studio.com', ip: null },
      },
    });
  });

  it('distinguishes a validated password from an open session when 2FA is active', () => {
    logLoginAttempt({
      user: { id: 7, totpEnabledAt: new Date() },
      granted: true,
      email: 'alice@studio.com',
    });

    const { data } = prismaMock.auditLog.create.mock.calls[0]![0] as {
      data: { action: string; metadata: Record<string, unknown> };
    };
    expect(data.action).toBe('LOGIN');
    expect(data.metadata.pending2fa).toBe(true);
  });

  it('has no way to log the password: it is never passed in', () => {
    logLoginAttempt({ user: { id: 7 }, granted: false, email: 'alice@studio.com' });

    expect(JSON.stringify(prismaMock.auditLog.create.mock.calls)).not.toContain('password');
  });
});

describe('Retention safeguards offered to the sweep (A5-04)', () => {
  it('excludes the actions that describe an erasure', () => {
    const cutoff = new Date('2026-01-01T00:00:00Z');
    expect(purgeableAuditWhere(cutoff)).toEqual({
      createdAt: { lt: cutoff },
      action: { notIn: AUDIT_UNPURGEABLE_ACTIONS },
    });
    expect(AUDIT_UNPURGEABLE_ACTIONS).toContain('RETENTION_CONFIG');
    expect(AUDIT_UNPURGEABLE_ACTIONS).toContain('RETENTION_RUN');
    expect(AUDIT_UNPURGEABLE_ACTIONS).toContain('RETENTION_SWEEP');
  });

  it('sets a retention floor that makes the "1 day" manoeuvre impossible', () => {
    expect(AUDIT_RETENTION_MIN_DAYS).toBeGreaterThanOrEqual(90);
  });
});
