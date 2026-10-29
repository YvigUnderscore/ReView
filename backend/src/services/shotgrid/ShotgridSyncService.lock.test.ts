// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The "one sync at a time" lock was set AFTER `await openConnection(...)`.
 *
 * Node does not preempt, but it yields on every `await`: a burst of ShotGrid events entered `runSync` in full, waited for the connection, then found the lock still free
 * — and each set it in turn. The studio's journal bore the trace: fifteen synchronizations in eleven seconds, all on the same 47 entities.
 *
 * This test replays exactly that burst: several calls launched without waiting for one another, on a deliberately slow connection to open.
 */

const { openConnection } = vi.hoisted(() => ({ openConnection: vi.fn() }));

vi.mock('./ShotgridConfigService', () => ({
  openConnection,
  markStatus: vi.fn(),
}));
vi.mock('./ShotgridSyncJournal', () => ({
  SyncJournal: {
    start: vi.fn().mockResolvedValue({
      runId: 1,
      count: vi.fn(),
      log: vi.fn(),
      finish: vi.fn(),
      stats: () => ({}),
    }),
  },
}));
vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { runSync } from './ShotgridSyncService';

/** Inactive connection: the pass stops right after the lock, without touching the network. */
const slowInactiveConnection = (delayMs: number) =>
  openConnection.mockImplementation(
    async () =>
      new Promise((resolve) => setTimeout(() => resolve({ connection: { id: 7, active: false } }), delayMs)),
  );

beforeEach(() => vi.clearAllMocks());

describe('runSync: lock taken before any wait', () => {
  it('a burst of five requests opens the connection only once', async () => {
    slowInactiveConnection(20);

        // Launched without `await` between them: this is the burst of webhooks.
    const results = await Promise.all([runSync(461), runSync(461), runSync(461), runSync(461), runSync(461)]);

    expect(openConnection).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'deferred')).toHaveLength(4);
  });

  it('two different projects do not block each other', async () => {
    slowInactiveConnection(10);

    const [a, b] = await Promise.all([runSync(461), runSync(462)]);

    expect(openConnection).toHaveBeenCalledTimes(2);
    expect(a.status).not.toBe('deferred');
    expect(b.status).not.toBe('deferred');
  });

  it('releases the lock when the connection is unreachable', async () => {
    openConnection.mockRejectedValueOnce(new Error('site injoignable'));
    await expect(runSync(461)).rejects.toThrow('site injoignable');

        // Without release, the project stayed locked until the worker restarted.
    slowInactiveConnection(0);
    await expect(runSync(461)).resolves.toMatchObject({ status: 'ok' });
  });
});
