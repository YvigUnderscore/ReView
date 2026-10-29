// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetShutdownState,
  __resetShutdownTasks,
  registerShutdownTask,
  runShutdownTasks,
  shutdown,
  shutdownTaskCount,
  type ShutdownTask,
} from './gracefulShutdown';

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const task = (over: Partial<ShutdownTask> & Pick<ShutdownTask, 'name'>): ShutdownTask => ({
  phase: 10,
  run: () => Promise.resolve(),
  ...over,
});

describe('runShutdownTasks', () => {
  beforeEach(() => {
    __resetShutdownTasks();
    __resetShutdownState();
  });

  it('runs all the tasks and returns a report', async () => {
    const seen: string[] = [];
    const out = await runShutdownTasks(
      [
        task({ name: 'http', run: async () => void seen.push('http') }),
        task({ name: 'prisma', phase: 20, run: async () => void seen.push('prisma') }),
      ],
      1000,
    );
    expect(seen).toEqual(['http', 'prisma']);
    expect(out).toEqual([
      { name: 'http', ok: true, timedOut: false },
      { name: 'prisma', ok: true, timedOut: false },
    ]);
  });

  it('respects the order of the phases: phase 20 waits for the end of phase 10', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const slow = task({
      name: 'workers',
      run: () =>
        new Promise<void>((r) =>
          setTimeout(() => {
            seen.push('workers');
            r();
          }, 500),
        ),
    });
    const later = task({ name: 'redis', phase: 20, run: async () => void seen.push('redis') });
    const p = runShutdownTasks([later, slow], 5000);
    await vi.advanceTimersByTimeAsync(499);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(seen).toEqual(['workers', 'redis']);
    vi.useRealTimers();
  });

  it('the tasks of the same phase start in parallel', async () => {
    vi.useFakeTimers();
    const done: string[] = [];
    const mk = (name: string, ms: number) =>
      task({
        name,
        run: () =>
          new Promise<void>((r) =>
            setTimeout(() => {
              done.push(name);
              r();
            }, ms),
          ),
      });
    const p = runShutdownTasks([mk('a', 300), mk('b', 300)], 5000);
    await vi.advanceTimersByTimeAsync(301);
    await p;
    expect(done.sort()).toEqual(['a', 'b']);
    vi.useRealTimers();
  });

  it('bounds a task that never returns control, and forces it', async () => {
    vi.useFakeTimers();
    const force = vi.fn();
    const p = runShutdownTasks(
      [task({ name: 'stuck', run: () => new Promise<void>(() => undefined), force })],
      1000,
    );
    await vi.advanceTimersByTimeAsync(1001);
    const out = await p;
    expect(out).toEqual([{ name: 'stuck', ok: false, timedOut: true }]);
    expect(force).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('the budget is global: a slow phase leaves nothing for the next one', async () => {
    vi.useFakeTimers();
    const force = vi.fn();
    const p = runShutdownTasks(
      [
        task({ name: 'slow', run: () => new Promise<void>(() => undefined) }),
        task({ name: 'after', phase: 20, run: () => new Promise<void>(() => undefined), force }),
      ],
      1000,
    );
    await vi.advanceTimersByTimeAsync(1001);
    const out = await p;
    expect(out.map((o) => o.timedOut)).toEqual([true, true]);
    expect(force).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a failing task does not prevent the others', async () => {
    const out = await runShutdownTasks(
      [task({ name: 'boom', run: () => Promise.reject(new Error('nope')) }), task({ name: 'ok', phase: 20 })],
      1000,
    );
    expect(out[0]).toMatchObject({ name: 'boom', ok: false, timedOut: false });
    expect(out[1]).toMatchObject({ name: 'ok', ok: true });
  });

  it('the failure of forcing does not interrupt the shutdown', async () => {
    vi.useFakeTimers();
    const p = runShutdownTasks(
      [
        task({
          name: 'stuck',
          run: () => new Promise<void>(() => undefined),
          force: () => {
            throw new Error('force failed');
          },
        }),
      ],
      100,
    );
    await vi.advanceTimersByTimeAsync(101);
    await expect(p).resolves.toEqual([{ name: 'stuck', ok: false, timedOut: true }]);
    vi.useRealTimers();
  });

  it('nothing to do without a registered task', async () => {
    await expect(runShutdownTasks([], 1000)).resolves.toEqual([]);
  });
});

describe('shutdown', () => {
  beforeEach(() => {
    __resetShutdownTasks();
    __resetShutdownState();
  });
  afterEach(() => {
    __resetShutdownTasks();
    __resetShutdownState();
  });

  it('runs the registered tasks only once', async () => {
    const run = vi.fn(() => Promise.resolve());
    registerShutdownTask({ name: 'x', phase: 10, run });
    expect(shutdownTaskCount()).toBe(1);
    expect(await shutdown('SIGTERM', 1000)).toBe(0);
    expect(await shutdown('SIGTERM', 1000)).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('returns a non-zero code if a task failed', async () => {
    registerShutdownTask({ name: 'x', phase: 10, run: () => Promise.reject(new Error('nope')) });
    expect(await shutdown('SIGINT', 1000)).toBe(1);
  });
});
