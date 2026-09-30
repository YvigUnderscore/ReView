// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from './logger';

/**
 * Arrêt propre des deux process (API et worker).
 *
 * `docker compose stop|restart|up --build` envoie SIGTERM puis SIGKILL dix secondes plus
 * tard. Sans personne à l'écoute, le transcodage en cours perd son verrou BullMQ, le job
 * est rejoué depuis le début et, au deuxième calage, le média reste `PROCESSING` sans
 * message : indiscernable d'un travail en cours.
 *
 * On enregistre donc des tâches d'extinction ordonnées par **phase** : d'abord cesser
 * d'accepter du travail (serveur HTTP, sockets, consommateurs de files), ensuite couper
 * les connexions (Prisma, Redis). Les tâches d'une même phase s'éteignent en parallèle,
 * et l'ensemble est borné par un délai de grâce : passé ce délai, on force et on sort,
 * parce qu'un process qui refuse de mourir sera tué sans ménagement de toute façon.
 */

/** Phase : les tâches s'exécutent par phase croissante, en parallèle au sein d'une phase. */
export const SHUTDOWN_PHASE = {
  /** Cesser d'accepter du travail neuf (HTTP, sockets, workers BullMQ). */
  STOP_INTAKE: 10,
  /** Couper les connexions sortantes (base, Redis). */
  DISCONNECT: 20,
} as const;

/**
 * Délai de grâce par défaut. Docker laisse dix secondes avant SIGKILL
 * (`stop_grace_period`) : on garde une marge pour journaliser la sortie.
 */
export const SHUTDOWN_GRACE_MS = 8_000;

export interface ShutdownTask {
  name: string;
  phase: number;
  run: () => Promise<void>;
  /**
   * Appelée si `run` n'a pas rendu la main dans le délai imparti. Sert à forcer ce qui
   * peut l'être (un worker BullMQ qui attend la fin d'un encodage de vingt minutes).
   * Best effort, jamais attendue.
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

/** Enregistre une tâche d'extinction. L'ordre d'enregistrement ne compte pas, la phase si. */
export function registerShutdownTask(task: ShutdownTask): void {
  tasks.push(task);
}

/** Vide le registre — réservé aux tests. */
export function __resetShutdownTasks(): void {
  tasks.length = 0;
}

/** Nombre de tâches enregistrées (diagnostic et tests). */
export const shutdownTaskCount = (): number => tasks.length;

/** Copie des tâches enregistrées — réservé aux tests. */
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
        // Le forçage est un dernier recours : son échec ne doit rien empêcher.
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
 * Exécute les tâches par phase croissante, l'ensemble borné par `totalMs`.
 * Chaque phase reçoit le budget restant ; une phase qui l'épuise n'empêche pas les
 * suivantes de tenter leur chance (elles auront un budget nul et seront forcées).
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

/** Déroule l'extinction une seule fois, quel que soit le nombre de signaux reçus. */
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

/** Vrai dès qu'un signal d'arrêt a été reçu (les boucles de fond peuvent s'y référer). */
export const isShuttingDown = (): boolean => shuttingDown;

/** Réinitialise l'état d'extinction — réservé aux tests. */
export function __resetShutdownState(): void {
  shuttingDown = false;
}

/**
 * Pose les gestionnaires SIGTERM/SIGINT. Un second signal pendant l'extinction sort
 * immédiatement : l'exploitant qui insiste veut que ça s'arrête, pas qu'on discute.
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
