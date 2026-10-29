// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A5-03: the detail of an account returns `metadata`, and returns it REDACTED.
 *
 * The activity was served without `metadata`: "MEDIA_PURGE · MediaObject · 812" without saying which
 * of the three hundred identifiers in the batch had gone. The studio view now returns it; if this view
 * returned it raw, it would expose what the other one protects: a webhook URL whose path IS the secret,
 * a password slipped into the context.
 *
 * `redactAuditMetadata` is NOT faked here: the composition is exactly what is being verified.
 */
vi.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    projectMembership: { findMany: vi.fn() },
    userSession: { findMany: vi.fn() },
    apiToken: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
    mediaObject: { count: vi.fn() },
    version: { count: vi.fn() },
    comment: { count: vi.fn() },
    task: { count: vi.fn() },
  },
}));
vi.mock('../lib/userView', () => ({ toPublicUser: vi.fn((u: object) => Promise.resolve(u)) }));
vi.mock('./PresenceService', () => ({ getOnlineUserIds: () => [] as number[] }));

import { userDetail } from './AdminUserService';
import { prisma } from '../lib/prisma';

type Activity = { action: string; metadata: unknown }[];
const activityOf = async (): Promise<Activity> => (await userDetail(1)).activity;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 1, email: 'a@b.c' } as never);
  for (const list of [prisma.projectMembership, prisma.userSession, prisma.apiToken]) {
    vi.mocked(list.findMany).mockResolvedValue([] as never);
  }
  for (const c of [prisma.mediaObject, prisma.version, prisma.comment, prisma.task]) {
    vi.mocked(c.count).mockResolvedValue(0);
  }
  vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
});

describe('userDetail: activity', () => {
  it('does request `metadata` from the database', async () => {
    await userDetail(1);
    const args = vi.mocked(prisma.auditLog.findMany).mock.calls[0]![0] as {
      select: Record<string, boolean>;
    };
    expect(args.select.metadata).toBe(true);
  });

  it('returns the useful context: the identifiers of the purged batch', async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { id: 9, action: 'MEDIA_PURGE', entityType: 'MediaObject', entityId: 812, metadata: { ids: [1, 2] } },
    ] as never);
    expect((await activityOf())[0]!.metadata).toEqual({ ids: [1, 2] });
  });

  it('redacts secrets and reduces URLs to their origin', async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { id: 9, action: 'WEBHOOK_UPDATE', metadata: { url: 'https://hooks.slack.com/services/T/B/XYZ' } },
      { id: 8, action: 'SMTP_UPDATE', metadata: { password: 'hunter2' } },
    ] as never);
    const rows = await activityOf();
    expect(rows[0]!.metadata).toEqual({ url: 'https://hooks.slack.com/…' });
    expect(rows[1]!.metadata).toEqual({ password: '[Redacted]' });
  });
});
