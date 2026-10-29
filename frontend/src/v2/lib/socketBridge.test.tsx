// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

/**
 * The socket bridge measured in REQUESTS, not in intentions.
 *
 * A batch of statuses on thirty shots emitted thirty `shot:update`; each one triggered five
 * invalidations, including the whole kanban — the heaviest read in the application. With eight
 * artists having the kanban open, a single production gesture sent hundreds of requests, almost all
 * cancelled in flight. Here we count the calls to `queryFn`: that is exactly the number of HTTP
 * requests a browser would have issued.
 */

/** Fake socket: the handlers are triggered by hand, without network. */
const handlers = new Map<string, Set<(payload: unknown) => void>>();
const socket = {
  on(event: string, fn: (payload: unknown) => void) {
    const set = handlers.get(event) ?? new Set<(payload: unknown) => void>();
    set.add(fn);
    handlers.set(event, set);
  },
  off(event: string, fn: (payload: unknown) => void) {
    handlers.get(event)?.delete(fn);
  },
  emit: vi.fn(),
};
const fire = (event: string, payload: unknown): void => {
  for (const fn of [...(handlers.get(event) ?? [])]) fn(payload);
};

// `emitActivity`: the bridge also carries the presence heartbeat — inert here, but it must
// exist, otherwise mounting the bridge throws before any invalidation measurement.
vi.mock('../../lib/socket', () => ({ getSocket: () => socket, emitActivity: () => undefined }));

import { useSocketInvalidation, COALESCE_WINDOW_MS, dropRedundantKeys } from './socketBridge';
import { qk } from './query';

const PROJECT = 1;
const SHOT = 7;

let calls: Record<string, number>;
const counted = (name: string) => () => {
  calls[name] = (calls[name] ?? 0) + 1;
  return Promise.resolve({ name });
};

/** A screen holding the kanban, the shot list and a shot record open. */
function Screen() {
  useSocketInvalidation(PROJECT);
  useQuery({ queryKey: qk.projectBoard(PROJECT), queryFn: counted('board') });
  useQuery({ queryKey: qk.shots(PROJECT), queryFn: counted('shots') });
  useQuery({ queryKey: qk.projectActivity(PROJECT), queryFn: counted('activity') });
  useQuery({ queryKey: qk.shot(SHOT), queryFn: counted('shot') });
  useQuery({ queryKey: qk.shotTree(SHOT), queryFn: counted('shotTree') });
  return null;
}

/** Lets the timers (grouping window) and pending promises run. */
const settle = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const mount = async (): Promise<void> => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } },
  });
  render(
    <QueryClientProvider client={client}>
      <Screen />
    </QueryClientProvider>,
  );
  // First load: five requests, which we reset before measuring.
  await settle();
  calls = {};
};

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  calls = {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSocketInvalidation — grouping invalidations', () => {
  it('a batch of thirty shots reloads the kanban only once', async () => {
    await mount();

    // What the server used to do before the fix: one event per shot.
    for (let id = 1; id <= 30; id++) fire('shot:update', { projectId: PROJECT, id });
    await settle(COALESCE_WINDOW_MS * 2);

    // Measured before the fix on this same screen: 93 requests
    // (30 kanban + 30 shot lists + 30 activities + 1 record + 2 trees).
    expect(calls).toEqual({ board: 1, shots: 1, activity: 1, shot: 1, shotTree: 1 });
  });

  it('a batch event (`ids`) refreshes each shot of the batch without multiplying the lists', async () => {
    await mount();

    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    // What the server does after the fix: ONE event describing the batch.
    fire('shot:update', { projectId: PROJECT, id: ids[0], ids: [...ids, SHOT] });
    await settle(COALESCE_WINDOW_MS * 2);

    // The open shot is part of the batch: its record updates, only once.
    expect(calls).toEqual({ board: 1, shots: 1, activity: 1, shot: 1, shotTree: 1 });
  });

  it('an isolated change is visible straight away', async () => {
    await mount();

    fire('shot:update', { projectId: PROJECT, id: SHOT });
    // Without advancing by a single window: the first event of a burst goes out as early as possible.
    await settle();

    expect(calls.board ?? 0).toBe(1);
    expect(calls.shot ?? 0).toBe(1);
  });

  it('a second change, later, reloads again — the window does not put the screen to sleep', async () => {
    await mount();

    fire('shot:update', { projectId: PROJECT, id: SHOT });
    await settle(COALESCE_WINDOW_MS * 3);
    fire('shot:update', { projectId: PROJECT, id: SHOT });
    await settle(COALESCE_WINDOW_MS * 3);

    expect(calls.board ?? 0).toBe(2);
  });

  it('a key and its prefix do not trigger two requests on the same record', async () => {
    await mount();

    // `shot:update` invalidated `['shot', id]` THEN `['shot', id, 'tree']`: the second
    // invalidation cancelled the tree request already in flight and started another one.
    fire('shot:update', { projectId: PROJECT, id: SHOT });
    await settle(COALESCE_WINDOW_MS * 2);

    expect(calls.shotTree ?? 0).toBe(1);
  });

  it('shots outside the batch are not reloaded', async () => {
    await mount();

    fire('shot:update', { projectId: PROJECT, id: SHOT + 100 });
    await settle(COALESCE_WINDOW_MS * 2);

    expect(calls.shot ?? 0).toBe(0);
    expect(calls.board ?? 0).toBe(1);
  });
});

describe('dropRedundantKeys', () => {
  it('keeps the prefix and drops the key it already covers', () => {
    const kept = dropRedundantKeys([
      ['shot', 7],
      ['shot', 7, 'tree'],
      ['tasks', 'board', 1],
    ]);
    expect(kept).toEqual([
      ['shot', 7],
      ['tasks', 'board', 1],
    ]);
  });

  it('does not touch sibling keys', () => {
    const keys = [
      ['shot', 7],
      ['shot', 8],
    ];
    expect(dropRedundantKeys(keys)).toEqual(keys);
  });

  it('lets an empty key through alone and absorbs everything else with it', () => {
    expect(dropRedundantKeys([[], ['shot', 7]])).toEqual([[]]);
  });
});
