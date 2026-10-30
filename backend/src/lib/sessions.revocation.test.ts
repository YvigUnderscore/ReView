// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: {
    userSession: { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    apiToken: { updateMany: vi.fn() },
  },
}));
vi.mock('./redis', () => ({ publishRedis: vi.fn() }));

import {
  revokeSession,
  revokeAllSessions,
  revokeAllCredentials,
  markSessionsRevoked,
  decodeSessionRevocation,
  encodeSessionRevocation,
  isSessionActive,
  SESSION_REVOCATION_CHANNEL,
} from './sessions';
import { prisma } from './prisma';
import { publishRedis } from './redis';

/** The `sid`s published during the last call, decoded with the production decoder. */
const published = (): string[][] =>
  vi
    .mocked(publishRedis)
    .mock.calls.filter((c) => c[0] === SESSION_REVOCATION_CHANNEL)
    .map((c) => decodeSessionRevocation(c[1]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.userSession.findMany).mockResolvedValue([{ id: 'a' }, { id: 'b' }] as never);
  vi.mocked(prisma.userSession.updateMany).mockResolvedValue({ count: 2 });
  vi.mocked(prisma.apiToken.updateMany).mockResolvedValue({ count: 1 });
});

/**
 * A3-02, immediate part. The validity cache is **per process** and the socket sweep runs every minute: revoking a session left the departing user's tab
 * receiving the project's internal comments for a minute, and the other replicas answering "session alive" for thirty seconds. Revocation must therefore announce itself.
 */
describe('revocation — publication on the shared channel', () => {
  it('announces the sid revoked by `revokeSession`', async () => {
    vi.mocked(prisma.userSession.updateMany).mockResolvedValue({ count: 1 });
    await expect(revokeSession('sid-morte')).resolves.toBe(true);
    expect(published()).toEqual([['sid-morte']]);
  });

  // A session already revoked (or belonging to someone else) updates nothing: announcing anyway would wake every replica for nothing.
  it('announces nothing when the revocation changed nothing', async () => {
    vi.mocked(prisma.userSession.updateMany).mockResolvedValue({ count: 0 });
    await expect(revokeSession('sid-inconnue')).resolves.toBe(false);
    expect(published()).toEqual([]);
  });

  it('announces all the sessions of a mass revocation', async () => {
    await revokeAllSessions(42);
    expect(published()).toEqual([['a', 'b']]);
  });

  /**
   * The point that would hurt most if missed: "revoke all my sessions" must not log out the author of the action. The spared session is excluded from the `where`,
   * hence absent from the list read — and therefore absent from the announcement.
   */
  it('never announces the spared session', async () => {
    vi.mocked(prisma.userSession.findMany).mockResolvedValue([{ id: 'a' }] as never);
    await revokeAllSessions(42, 'sid-courante');
    const where = vi.mocked(prisma.userSession.findMany).mock.calls[0]![0]!.where as Record<string, unknown>;
    expect(where).toMatchObject({ id: { not: 'sid-courante' } });
    expect(published()).toEqual([['a']]);
    expect(published()[0]).not.toContain('sid-courante');
  });

  // Offboarding / password change go through here: the announcement must follow.
  it('also announces when an account is taken back in hand', async () => {
    await revokeAllCredentials(42);
    expect(published()).toEqual([['a', 'b']]);
  });
});

describe('revocation channel contract', () => {
  it('round-trips', () => {
    expect(decodeSessionRevocation(encodeSessionRevocation(['x', 'y']))).toEqual(['x', 'y']);
  });

  /**
   * The channel is shared and nothing guarantees what is read from it: a pub/sub subscriber that throws kills the handler, not just the message.
   */
  it('swallows what is unreadable rather than throwing', () => {
    expect(decodeSessionRevocation('{pas du json')).toEqual([]);
    expect(decodeSessionRevocation('{"sids":"pas un tableau"}')).toEqual([]);
    expect(decodeSessionRevocation('null')).toEqual([]);
    expect(decodeSessionRevocation('{"sids":[1,"",null,"ok"]}')).toEqual(['ok']);
  });
});

/**
 * Closing the socket without dropping the cache would be cosmetic: `isSessionActive` would still answer "alive" for up to thirty seconds, and the API would
 * reopen the door that the real-time channel has just closed.
 */
describe('markSessionsRevoked — the replica cache drops straight away', () => {
  it('makes the session invalid without going to the database', async () => {
    markSessionsRevoked(['sid-distante']);
    await expect(isSessionActive('sid-distante')).resolves.toBe(false);
    expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
  });
});
