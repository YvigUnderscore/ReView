// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Pilotage de production (C6) — quatre questions, et rien d'autre.
 *
 * L'onglet alignait huit indicateurs « depuis toujours » (temps moyen par plan, notes par
 * version, décisions cumulées…) dont aucun ne disait où en est le projet ni ce qui bloque.
 * Ce service répond à ce qu'un chargé de production demande vraiment :
 *   1. où en est le projet — séquences × départements ;
 *   2. qu'est-ce qui est en retard ou bloqué ;
 *   3. qui fait quoi ;
 *   4. à quel rythme, et pour quelle fin projetée.
 *
 * Les fonctions de calcul sont pures et testées ; seules la lecture en base et
 * l'assemblage vivent dans `getOverview`.
 */

export type Family = 'todo' | 'progress' | 'review' | 'done' | 'blocked';

const FAMILY_OF: Record<TaskStatus, Family> = {
  TODO: 'todo',
  IN_PROGRESS: 'progress',
  PENDING_REVIEW: 'review',
  APPROVED: 'done',
  RETAKE: 'blocked',
  REJECTED: 'blocked',
};

export const EMPTY_CELL: Record<Family, number> = {
  todo: 0,
  progress: 0,
  review: 0,
  done: 0,
  blocked: 0,
};

/** Une tâche, réduite à ce dont le pilotage a besoin. */
export interface ProductionTask {
  id: number;
  name: string;
  status: TaskStatus;
  dueDate: Date | null;
  assigneeId: number | null;
  assigneeName: string | null;
  department: string | null;
  sequenceId: number | null;
  sequenceCode: string | null;
  parentLabel: string;
}

export interface MatrixCell extends Record<Family, number> {
  sequenceId: number | null;
  department: string | null;
  total: number;
}

/** Tableau croisé séquences × départements, en comptes par famille de statut. */
export function buildMatrix(tasks: ProductionTask[]): MatrixCell[] {
  const cells = new Map<string, MatrixCell>();
  for (const task of tasks) {
    const key = `${task.sequenceId ?? 'none'}::${task.department ?? 'none'}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { ...EMPTY_CELL, sequenceId: task.sequenceId, department: task.department, total: 0 };
      cells.set(key, cell);
    }
    cell[FAMILY_OF[task.status]] += 1;
    cell.total += 1;
  }
  return [...cells.values()];
}

export interface Attention {
  overdue: ProductionTask[];
  unassigned: ProductionTask[];
  waitingReview: ProductionTask[];
}

/**
 * Ce qui demande une décision. Une tâche terminée n'est jamais « en retard » : sa date est
 * passée, mais le travail est fait — la signaler noierait ce qui compte vraiment.
 */
export function findAttention(tasks: ProductionTask[], now: Date, limit = 50): Attention {
  const open = tasks.filter((t) => FAMILY_OF[t.status] !== 'done');
  const byDue = (a: ProductionTask, b: ProductionTask) =>
    (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
  return {
    overdue: open
      .filter((t) => t.dueDate !== null && t.dueDate.getTime() < now.getTime())
      .sort(byDue)
      .slice(0, limit),
    unassigned: open
      .filter((t) => t.assigneeId === null)
      .sort(byDue)
      .slice(0, limit),
    waitingReview: open
      .filter((t) => t.status === TaskStatus.PENDING_REVIEW)
      .sort(byDue)
      .slice(0, limit),
  };
}

export interface WorkloadRow {
  assigneeId: number | null;
  name: string | null;
  todo: number;
  progress: number;
  review: number;
  blocked: number;
  overdue: number;
  total: number;
}

/**
 * Charge par personne. L'assigné est transporté par l'API depuis toujours et n'était
 * affiché nulle part : impossible de voir qui portait quoi.
 */
export function buildWorkload(tasks: ProductionTask[], now: Date): WorkloadRow[] {
  const rows = new Map<number | null, WorkloadRow>();
  for (const task of tasks) {
    const family = FAMILY_OF[task.status];
    if (family === 'done') continue; // la charge, c'est ce qui reste à faire
    let row = rows.get(task.assigneeId);
    if (!row) {
      row = {
        assigneeId: task.assigneeId,
        name: task.assigneeName,
        todo: 0,
        progress: 0,
        review: 0,
        blocked: 0,
        overdue: 0,
        total: 0,
      };
      rows.set(task.assigneeId, row);
    }
    row[family] += 1;
    row.total += 1;
    if (task.dueDate !== null && task.dueDate.getTime() < now.getTime()) row.overdue += 1;
  }
  // Les plus chargés d'abord ; les tâches sans assigné ferment la marche, quel qu'en soit
  // le nombre — c'est un manque à combler, pas une personne à comparer aux autres.
  return [...rows.values()].sort((a, b) => {
    if ((a.assigneeId === null) !== (b.assigneeId === null)) return a.assigneeId === null ? 1 : -1;
    return b.total - a.total;
  });
}

export interface WeekPoint {
  /** Lundi de la semaine, en ISO court (AAAA-MM-JJ). */
  weekStart: string;
  delivered: number;
}

/** Lundi de la semaine contenant `date`, à minuit UTC. */
export function weekStartOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay : 0 = dimanche. On ramène au lundi précédent.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Livraisons par semaine sur la fenêtre demandée, semaines vides comprises. */
export function buildPace(dates: Date[], now: Date, weeks: number): WeekPoint[] {
  const start = weekStartOf(now);
  const points: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const week = new Date(start);
    week.setUTCDate(week.getUTCDate() - i * 7);
    points.push({ weekStart: isoDay(week), delivered: 0 });
  }
  const index = new Map(points.map((p, i) => [p.weekStart, i]));
  for (const date of dates) {
    const slot = index.get(isoDay(weekStartOf(date)));
    if (slot !== undefined) points[slot]!.delivered += 1;
  }
  return points;
}

export interface Projection {
  done: number;
  total: number;
  /** Moyenne de tâches terminées par semaine sur la fenêtre observée. */
  perWeek: number;
  /** Date projetée d'achèvement, `null` si le rythme est nul ou tout est fait. */
  projectedEnd: string | null;
}

/**
 * Projection de fin, au rythme observé. Elle vaut ce que vaut l'hypothèse — un rythme
 * constant — et c'est pourquoi elle est rendue avec le rythme lui-même : sans lui, une
 * date seule se lit comme un engagement.
 */
export function projectEnd(done: number, total: number, points: WeekPoint[], now: Date): Projection {
  const delivered = points.reduce((n, p) => n + p.delivered, 0);
  const perWeek = points.length > 0 ? delivered / points.length : 0;
  const remaining = Math.max(0, total - done);
  if (remaining === 0 || perWeek <= 0) return { done, total, perWeek, projectedEnd: null };
  const end = new Date(now.getTime());
  end.setUTCDate(end.getUTCDate() + Math.ceil((remaining / perWeek) * 7));
  return { done, total, perWeek, projectedEnd: isoDay(end) };
}

export interface ProductionOverview {
  matrix: MatrixCell[];
  sequences: { id: number; code: string }[];
  departments: string[];
  attention: Attention;
  workload: WorkloadRow[];
  pace: WeekPoint[];
  projection: Projection;
}

/** Vue de pilotage complète d'un projet. `weeks` borne la fenêtre de rythme. */
export async function getOverview(
  projectId: number,
  weeks = 8,
  now = new Date(),
): Promise<ProductionOverview> {
  const [rows, sequences, deliveries] = await Promise.all([
    prisma.task.findMany({
      where: {
        OR: [{ shot: { projectId, deletedAt: null } }, { asset: { projectId, deletedAt: null } }],
      },
      select: {
        id: true,
        name: true,
        status: true,
        dueDate: true,
        department: true,
        assignee: { select: { id: true, name: true } },
        shot: { select: { code: true, sequenceId: true, sequence: { select: { code: true } } } },
        asset: { select: { name: true } },
      },
    }),
    prisma.sequence.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { order: 'asc' },
      select: { id: true, code: true },
    }),
    prisma.mediaObject.findMany({
      where: {
        published: true,
        deletedAt: null,
        createdAt: { gte: new Date(now.getTime() - weeks * 7 * 86_400_000) },
        version: {
          OR: [
            { task: { shot: { projectId } } },
            { task: { asset: { projectId } } },
            { asset: { projectId } },
          ],
        },
      },
      select: { createdAt: true },
    }),
  ]);

  const tasks: ProductionTask[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    dueDate: r.dueDate,
    assigneeId: r.assignee?.id ?? null,
    assigneeName: r.assignee?.name ?? null,
    department: r.department,
    sequenceId: r.shot?.sequenceId ?? null,
    sequenceCode: r.shot?.sequence?.code ?? null,
    parentLabel: r.shot?.code ?? r.asset?.name ?? '',
  }));

  const pace = buildPace(
    deliveries.map((d) => d.createdAt),
    now,
    weeks,
  );
  const done = tasks.filter((t) => FAMILY_OF[t.status] === 'done').length;

  return {
    matrix: buildMatrix(tasks),
    sequences,
    // Les départements dans l'ordre où ils apparaissent, sans doublon ni valeur vide.
    departments: [...new Set(tasks.map((t) => t.department).filter((d): d is string => d !== null))].sort(),
    attention: findAttention(tasks, now),
    workload: buildWorkload(tasks, now),
    pace,
    projection: projectEnd(done, tasks.length, pace, now),
  };
}
