// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: {
    userSession: { findMany: vi.fn(), updateMany: vi.fn() },
    apiToken: { updateMany: vi.fn() },
  },
}));

import { listActiveSessions, revokeAllCredentials } from './sessions';
import { prisma } from './prisma';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.userSession.findMany).mockResolvedValue([{ id: 'a' }, { id: 'b' }] as never);
  vi.mocked(prisma.userSession.updateMany).mockResolvedValue({ count: 2 });
  vi.mocked(prisma.apiToken.updateMany).mockResolvedValue({ count: 1 });
});

/**
 * A session is not the only identifier of the account: an API token `rvk_` authenticates just as well, through a separate table. Revoking only the sessions
 * let a token the attacker had created survive — taking the account back in hand was illusory.
 */
describe('revokeAllCredentials', () => {
  it('revokes API tokens AS WELL AS the sessions', async () => {
    await revokeAllCredentials(42);
    expect(prisma.userSession.updateMany).toHaveBeenCalled();
    expect(prisma.apiToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 42, revokedAt: null } }),
    );
  });

  it('spares the current session but revokes the tokens anyway', async () => {
    await revokeAllCredentials(42, 'session-courante');
    const where = vi.mocked(prisma.userSession.updateMany).mock.calls[0]![0].where as Record<string, unknown>;
    expect(where).toMatchObject({ userId: 42, id: { not: 'session-courante' } });
    expect(prisma.apiToken.updateMany).toHaveBeenCalled();
  });
});

describe('listActiveSessions', () => {
  it('reads only the live sessions of the account, most recent first, without secrets', async () => {
    await listActiveSessions(7);
    const args = vi.mocked(prisma.userSession.findMany).mock.calls.at(-1)![0] as {
      where: Record<string, unknown>;
      orderBy: unknown;
      select: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({ userId: 7, revokedAt: null });
    expect(args.orderBy).toEqual({ lastSeenAt: 'desc' });
    expect(Object.keys(args.select).sort()).toEqual(['createdAt', 'id', 'ip', 'lastSeenAt', 'userAgent']);
  });
});
