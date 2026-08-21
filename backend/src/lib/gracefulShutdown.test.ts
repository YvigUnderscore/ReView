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

  it('exécute toutes les tâches et rend un compte rendu', async () => {
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

  it('respecte l’ordre des phases : la phase 20 attend la fin de la phase 10', async () => {
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

  it('les tâches d’une même phase partent en parallèle', async () => {
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

  it('borne une tâche qui ne rend jamais la main, et la force', async () => {
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

  it('le budget est global : une phase lente n’offre plus rien à la suivante', async () => {
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

  it('une tâche en échec n’empêche pas les autres', async () => {
    const out = await runShutdownTasks(
      [task({ name: 'boom', run: () => Promise.reject(new Error('nope')) }), task({ name: 'ok', phase: 20 })],
      1000,
    );
    expect(out[0]).toMatchObject({ name: 'boom', ok: false, timedOut: false });
    expect(out[1]).toMatchObject({ name: 'ok', ok: true });
  });

  it('l’échec du forçage n’interrompt pas l’extinction', async () => {
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

  it('sans tâche enregistrée : rien à faire', async () => {
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

  it('déroule les tâches enregistrées une seule fois', async () => {
    const run = vi.fn(() => Promise.resolve());
    registerShutdownTask({ name: 'x', phase: 10, run });
    expect(shutdownTaskCount()).toBe(1);
    expect(await shutdown('SIGTERM', 1000)).toBe(0);
    expect(await shutdown('SIGTERM', 1000)).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rend un code non nul si une tâche a échoué', async () => {
    registerShutdownTask({ name: 'x', phase: 10, run: () => Promise.reject(new Error('nope')) });
    expect(await shutdown('SIGINT', 1000)).toBe(1);
  });
});
