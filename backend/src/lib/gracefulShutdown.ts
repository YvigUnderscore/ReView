// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from './logger';

/**
 * Clean shutdown of both processes (API and worker).
 *
 * `docker compose stop|restart|up --build` sends SIGTERM, then SIGKILL ten seconds later. With nobody
 * listening, an in-flight transcode loses its BullMQ lock, the job is replayed from the start, and on the
 * second stall the media stays `PROCESSING` with no message: indistinguishable from a job still running.
 *
 * Shutdown tasks are therefore registered in ordered **phases**: first stop accepting work (HTTP server,
 * sockets, queue consumers), then close connections (Prisma, Redis). Tasks of the same phase shut down in
 * parallel, and the whole is bounded by a grace delay: past it, we force and exit, since a process that
 * refuses to die will be killed anyway.
 */

/** Phase: tasks run in increasing phase order, in parallel within a phase. */
export const SHUTDOWN_PHASE = {
  /** Stop accepting new work (HTTP, sockets, BullMQ workers). */
  STOP_INTAKE: 10,
  /** Close outgoing connections (database, Redis). */
  DISCONNECT: 20,
} as const;

/**
 * Default grace delay. Docker leaves ten seconds before SIGKILL (`stop_grace_period`): a margin is kept
 * to log the exit.
 */
export const SHUTDOWN_GRACE_MS = 8_000;

export interface ShutdownTask {
  name: string;
  phase: number;
  run: () => Promise<void>;
  /**
   * Called if `run` has not returned within the allotted delay. Forces whatever can be forced (a BullMQ
   * worker waiting for a twenty-minute encode to finish). Best effort, never awaited.
   */
  force?: () => void;
}

export interface ShutdownOutcome {
  name: string;
  ok: boolean;
  timedOut: boolean;
  error?: unknown;
}

const tasks: ShutdownTask[] = [];

/** Registers a shutdown task. Registration order does not matter, the phase does. */
export function registerShutdownTask(task: ShutdownTask): void {
  tasks.push(task);
}

/** Empties the registry — tests only. */
export function __resetShutdownTasks(): void {
  tasks.length = 0;
}

/** Number of registered tasks (diagnostics and tests). */
export const shutdownTaskCount = (): number => tasks.length;

/** Copy of the registered tasks — tests only. */
export const __shutdownTasks = (): readonly ShutdownTask[] => [...tasks];

function withDeadline(task: ShutdownTask, ms: number): Promise<ShutdownOutcome> {
  return new Promise<ShutdownOutcome>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        task.force?.();
      } catch {
        // Forcing is a last resort: its failure must not block anything.
      }
      resolve({ name: task.name, ok: false, timedOut: true });
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();

    void task.run().then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ name: task.name, ok: true, timedOut: false });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ name: task.name, ok: false, timedOut: false, error });
      },
    );
  });
}

/**
 * Runs the tasks in increasing phase order, the whole bounded by `totalMs`.
 * Each phase receives the remaining budget; a phase that exhausts it does not stop the next ones from trying
 * (they will have a zero budget and be forced).
 */
export async function runShutdownTasks(
  list: readonly ShutdownTask[],
  totalMs: number,
  now: () => number = Date.now,
): Promise<ShutdownOutcome[]> {
  const deadline = now() + totalMs;
  const phases = [...new Set(list.map((t) => t.phase))].sort((a, b) => a - b);
  const outcomes: ShutdownOutcome[] = [];
  for (const phase of phases) {
    const remaining = Math.max(0, deadline - now());
    const group = list.filter((t) => t.phase === phase);
    outcomes.push(...(await Promise.all(group.map((t) => withDeadline(t, remaining)))));
  }
  return outcomes;
}

let shuttingDown = false;

/** Runs the shutdown only once, whatever the number of signals received. */
export async function shutdown(signal: string, graceMs = SHUTDOWN_GRACE_MS): Promise<number> {
  if (shuttingDown) return 0;
  shuttingDown = true;
  logger.info({ signal, tasks: tasks.length }, '[shutdown] arrêt demandé');
  const outcomes = await runShutdownTasks(tasks, graceMs);
  for (const o of outcomes) {
    if (o.timedOut) logger.warn({ task: o.name }, '[shutdown] délai dépassé — forcé');
    else if (!o.ok) logger.warn({ task: o.name, err: o.error }, '[shutdown] tâche en échec');
  }
  const clean = outcomes.every((o) => o.ok);
  logger.info({ clean }, '[shutdown] terminé');
  return clean ? 0 : 1;
}

/** True as soon as a stop signal has been received (background loops may refer to it). */
export const isShuttingDown = (): boolean => shuttingDown;

/** Resets the shutdown state — tests only. */
export function __resetShutdownState(): void {
  shuttingDown = false;
}

/**
 * Installs the SIGTERM/SIGINT handlers. A second signal during shutdown exits immediately: an operator who
 * insists wants it to stop, not to negotiate.
 */
export function installShutdownHandlers(
  opts: { graceMs?: number; exit?: (code: number) => void } = {},
): void {
  const graceMs = opts.graceMs ?? SHUTDOWN_GRACE_MS;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) {
        logger.warn({ signal }, '[shutdown] second signal — sortie immédiate');
        exit(1);
        return;
      }
      void shutdown(signal, graceMs).then(exit, () => exit(1));
    });
  }
}
