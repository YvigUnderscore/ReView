// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWorkerShutdown } from './shutdown';
import {
  __resetShutdownState,
  __resetShutdownTasks,
  __shutdownTasks,
  runShutdownTasks,
  SHUTDOWN_PHASE,
} from '../lib/gracefulShutdown';

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('registerWorkerShutdown', () => {
  beforeEach(() => {
    __resetShutdownTasks();
    __resetShutdownState();
  });

  it('enregistre une tâche en phase « cesser d’accepter du travail »', () => {
    registerWorkerShutdown('ffmpeg.worker', { close: () => Promise.resolve() });
    const [task] = __shutdownTasks();
    expect(task?.name).toBe('ffmpeg.worker');
    expect(task?.phase).toBe(SHUTDOWN_PHASE.STOP_INTAKE);
    expect(SHUTDOWN_PHASE.STOP_INTAKE).toBeLessThan(SHUTDOWN_PHASE.DISCONNECT);
  });

  it('ferme le worker en douceur : les jobs actifs vont au bout', async () => {
    const close = vi.fn(() => Promise.resolve());
    registerWorkerShutdown('ffmpeg.worker', { close });
    await runShutdownTasks(__shutdownTasks(), 1000);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith();
  });

  it('un encodage qui dépasse le délai de grâce est forcé', async () => {
    vi.useFakeTimers();
    const close = vi.fn((force?: boolean) =>
      force === true ? Promise.resolve() : new Promise<void>(() => undefined),
    );
    registerWorkerShutdown('ffmpeg.worker', { close });
    const p = runShutdownTasks(__shutdownTasks(), 500);
    await vi.advanceTimersByTimeAsync(501);
    const out = await p;
    expect(out[0]?.timedOut).toBe(true);
    expect(close).toHaveBeenCalledWith(true);
    vi.useRealTimers();
  });

  it('un échec de fermeture forcée est absorbé, l’extinction continue', async () => {
    vi.useFakeTimers();
    const close = vi.fn((force?: boolean) =>
      force === true ? Promise.reject(new Error('redis gone')) : new Promise<void>(() => undefined),
    );
    registerWorkerShutdown('webhook.worker', { close });
    const p = runShutdownTasks(__shutdownTasks(), 200);
    await vi.advanceTimersByTimeAsync(201);
    await expect(p).resolves.toEqual([{ name: 'webhook.worker', ok: false, timedOut: true }]);
    vi.useRealTimers();
  });

  it('les cinq consommateurs de file s’enregistrent tous', () => {
    for (const name of [
      'ffmpeg.worker',
      'storageCleanup.worker',
      'webhook.worker',
      'timelineExport.worker',
      'shotgrid.worker',
      'maintenance.worker',
    ])
      registerWorkerShutdown(name, { close: () => Promise.resolve() });
    expect(__shutdownTasks().map((t) => t.name)).toHaveLength(6);
    expect(__shutdownTasks().every((t) => t.phase === SHUTDOWN_PHASE.STOP_INTAKE)).toBe(true);
  });
});
