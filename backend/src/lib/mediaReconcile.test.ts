// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Test doubles: the BullMQ queue and the database. What is measured here is the **number and scope of the Redis
 * reads** — `getJobs` without a range fetches the whole backlog, complete job by complete job, at every maintenance pass.
 */
const mocks = vi.hoisted(() => ({
  getJobs: vi.fn<(types: string[], start?: number, end?: number) => Promise<unknown[]>>(),
  findMany: vi.fn<() => Promise<{ id: number; createdAt: Date; metadata: unknown }[]>>(),
  updateMany: vi.fn<(args: unknown) => Promise<{ count: number }>>(),
}));
vi.mock('./queues', () => ({ mediaQueue: { getJobs: mocks.getJobs } }));
vi.mock('./prisma', () => ({
  prisma: { mediaObject: { findMany: mocks.findMany, updateMany: mocks.updateMany } },
}));
vi.mock('./logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  liveMediaJobIds,
  LIVE_JOB_SCAN_MAX,
  MEDIA_STUCK_AFTER_MS,
  reconcileAction,
  reconcileFailureMessage,
  reconcileStuckMedia,
} from './mediaReconcile';

afterEach(() => {
  mocks.getJobs.mockReset();
  mocks.findMany.mockReset();
  mocks.updateMany.mockReset();
});

/** Fake BullMQ job: only its payload matters for reconciliation. */
const job = (mediaObjectId: number) => ({ data: { mediaObjectId } });

const candidate = (over: Partial<Parameters<typeof reconcileAction>[0]> = {}) => ({
  id: 1,
  ageMs: MEDIA_STUCK_AFTER_MS + 1,
  hasLiveJob: false,
  ...over,
});

describe('reconcileAction', () => {
  it('a live job protects the media, even a very old one', () => {
    expect(reconcileAction(candidate({ hasLiveJob: true, ageMs: 48 * 3600_000 }))).toBe('skip');
  });

  it('a recent media is spared: the sweep does not run faster than the enqueueing', () => {
    expect(reconcileAction(candidate({ ageMs: 0 }))).toBe('skip');
    expect(reconcileAction(candidate({ ageMs: MEDIA_STUCK_AFTER_MS - 1 }))).toBe('skip');
  });

  it('old and without a live job: explicit failure', () => {
    expect(reconcileAction(candidate({ ageMs: MEDIA_STUCK_AFTER_MS }))).toBe('fail');
    expect(reconcileAction(candidate({ ageMs: 3 * MEDIA_STUCK_AFTER_MS }))).toBe('fail');
  });

  it('the threshold is configurable', () => {
    expect(reconcileAction(candidate({ ageMs: 5000 }), 1000)).toBe('fail');
    expect(reconcileAction(candidate({ ageMs: 500 }), 1000)).toBe('skip');
  });

  it('both conditions must be met together', () => {
    expect(reconcileAction(candidate({ hasLiveJob: true, ageMs: 0 }))).toBe('skip');
    expect(reconcileAction(candidate({ hasLiveJob: false, ageMs: 0 }))).toBe('skip');
    expect(reconcileAction(candidate({ hasLiveJob: true, ageMs: 1e9 }))).toBe('skip');
    expect(reconcileAction(candidate({ hasLiveJob: false, ageMs: 1e9 }))).toBe('fail');
  });
});

describe('reconcileFailureMessage', () => {
  it('actionable message, in English, with the duration in minutes', () => {
    expect(reconcileFailureMessage(90 * 60_000)).toContain('90 min');
    expect(reconcileFailureMessage(90 * 60_000)).toMatch(/^Processing was interrupted/);
  });

  it('never "0 min": a one-minute floor', () => {
    expect(reconcileFailureMessage(1200)).toContain('1 min');
  });

  it('fits within the 500 characters kept by the worker', () => {
    expect(reconcileFailureMessage(10 ** 9).length).toBeLessThan(500);
  });
});

// ── Cost of reading the live jobs ──

describe('liveMediaJobIds', () => {
  it('bounds its Redis read with an explicit range', async () => {
    mocks.getJobs.mockResolvedValue([job(1), job(2), job(2), { data: {} }, null]);
    const live = await liveMediaJobIds();
    expect(live.ids).toEqual(new Set([1, 2]));
    expect(live.complete).toBe(true);
    // A single read, and a range — not `getJobs(types)`, which brings back the whole backlog.
    expect(mocks.getJobs).toHaveBeenCalledTimes(1);
    const [types, start, end] = mocks.getJobs.mock.calls[0]!;
    expect(types).toEqual(['waiting', 'active', 'delayed', 'paused', 'prioritized', 'waiting-children']);
    expect(start).toBe(0);
    expect(end).toBe(LIVE_JOB_SCAN_MAX - 1);
  });

  it('reports a saturated read rather than believing it exhaustive', async () => {
    mocks.getJobs.mockResolvedValue(Array.from({ length: LIVE_JOB_SCAN_MAX }, (_, i) => job(i + 1)));
    const live = await liveMediaJobIds();
    expect(live.complete).toBe(false);
  });
});

describe('reconcileStuckMedia', () => {
  const old = new Date(Date.now() - 3 * MEDIA_STUCK_AFTER_MS);
  const now = new Date();

  it('condemns the media without a live job and spares the one that has one', async () => {
    mocks.findMany.mockResolvedValue([
      { id: 10, createdAt: old, metadata: { width: 1920 } },
      { id: 11, createdAt: old, metadata: null },
    ]);
    mocks.getJobs.mockResolvedValue([job(11)]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    expect(await reconcileStuckMedia(now)).toBe(1);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    const arg = mocks.updateMany.mock.calls[0]?.[0] as {
      where: { id: number; status: MediaStatus };
      data: { status: MediaStatus; metadata: Record<string, unknown> };
    };
    expect(arg.where).toEqual({ id: 10, status: MediaStatus.PROCESSING });
    expect(arg.data.status).toBe(MediaStatus.FAILED);
    // Existing metadata is kept, the reason is added.
    expect(arg.data.metadata.width).toBe(1920);
    expect(String(arg.data.metadata.processingError)).toMatch(/^Processing was interrupted/);
  });

  it('condemns no one when the job read is truncated', async () => {
    mocks.findMany.mockResolvedValue([{ id: 10, createdAt: old, metadata: null }]);
    mocks.getJobs.mockResolvedValue(Array.from({ length: LIVE_JOB_SCAN_MAX }, (_, i) => job(i + 1000)));
    expect(await reconcileStuckMedia(now)).toBe(0);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('does not even read the queue when no media is stuck', async () => {
    mocks.findMany.mockResolvedValue([]);
    expect(await reconcileStuckMedia(now)).toBe(0);
    expect(mocks.getJobs).not.toHaveBeenCalled();
  });
});
