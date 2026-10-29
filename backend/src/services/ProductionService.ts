// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  FAMILY_OF_ENUM,
  TASK_OPEN_FILTER,
  TASK_REVIEW_FILTER,
  familyOf,
  statusRefOf,
  type Family,
  type FamilyOrInactive,
} from '../lib/statusFamily';

/**
 * Production steering (C6): four questions, and nothing else.
 *
 *   1. where the project stands — sequences x departments;
 *   2. what is late or blocked;
 *   3. who does what;
 *   4. at what pace, and to what projected end.
 *
 * Two rules govern the implementation.
 *
 * First, **the database counts**. The view used to load every task of the project (about 10,000 at target)
 * and all published media of the window to count them in JavaScript; it now only reads
 * aggregates — one row per sequence x department x status intersection, and at most 150 named tasks for the
 * three attention lists.
 *
 * Then, **the status read is the studio's**. The families are derived from `PipelineStatus` (`isDone`,
 * `isInactive`, `legacyStatus`) and fall back on the frozen enum when no customizable
 * status is set — see `lib/statusFamily`. An "omitted" shot no longer weighs on the gauges; an "end" shot
 * finally counts as done.
 *
 * The computation functions remain pure and tested; only the database read and the assembly live in
 * `getOverview`.
 */

export type { Family };

export const EMPTY_CELL: Record<Family, number> = {
  todo: 0,
  progress: 0,
  review: 0,
  done: 0,
  blocked: 0,
};

/**
 * What a gauge reads from a row: its status, its family if the database has already resolved it, and the
 * number of tasks it represents. A task is worth one row of count 1 — this is what
 * lets the same functions serve both the SQL aggregates and the named lists.
 */
interface CountedRow {
  status: TaskStatus;
  family?: FamilyOrInactive;
  count?: number;
}

const familyOfRow = (row: CountedRow): FamilyOrInactive => row.family ?? FAMILY_OF_ENUM[row.status];
const countOf = (row: CountedRow): number => row.count ?? 1;

/** A task, reduced to what steering needs. */
export interface ProductionTask extends CountedRow {
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

/** A cell of the cross-tab, before folding: the intersection and its count. */
export interface MatrixRow extends CountedRow {
  sequenceId: number | null;
  department: string | null;
}

/** Sequences x departments cross-tab, in counts per status family. */
export function buildMatrix(rows: MatrixRow[]): MatrixCell[] {
  const cells = new Map<string, MatrixCell>();
  for (const row of rows) {
    const family = familyOfRow(row);
    // Neither to do nor done: an inactive status weighs on no progress gauge.
    if (family === 'inactive') continue;
    const key = `${row.sequenceId ?? 'none'}::${row.department ?? 'none'}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { ...EMPTY_CELL, sequenceId: row.sequenceId, department: row.department, total: 0 };
      cells.set(key, cell);
    }
    const n = countOf(row);
    cell[family] += n;
    cell.total += n;
  }
  return [...cells.values()];
}

/**
 * How many tasks require a decision — the TOTALS, not the length of the lists.
 *
 * The tiles displayed `.length` of lists capped at fifty: a project with three hundred late tasks announced
 * "50". And the "what blocks" badge summed the three numbers, so a task both late AND
 * unassigned was counted twice. `blocking` is therefore counted in the database over the UNION of the three
 * conditions — de-duplicated by construction, and never equal to the sum.
 */
export interface AttentionTotals {
  overdue: number;
  unassigned: number;
  waitingReview: number;
  /** Distinct tasks concerned by at least one of the three conditions. */
  blocking: number;
}

export interface Attention {
  overdue: ProductionTask[];
  unassigned: ProductionTask[];
  waitingReview: ProductionTask[];
  totals: AttentionTotals;
  /** Cap applied to the three lists: beyond it, read the totals. */
  limit: number;
}

/** The three lists alone, without the totals that only the database can count. */
export type AttentionLists = Pick<Attention, 'overdue' | 'unassigned' | 'waitingReview'>;

/**
 * What requires a decision. A finished task is never "late": its date has passed, but the work is done —
 * flagging it would drown what really matters. An inactive task (omitted, not applicable) expects nothing
 * from anyone and likewise disappears.
 */
export function findAttention(tasks: ProductionTask[], now: Date, limit = 50): AttentionLists {
  const open = tasks.filter((t) => {
    const family = familyOfRow(t);
    return family !== 'done' && family !== 'inactive';
  });
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
      .filter((t) => familyOfRow(t) === 'review')
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

/** A load row before folding: the person, their status, their count. */
export interface WorkloadInput extends CountedRow {
  assigneeId: number | null;
  assigneeName: string | null;
  dueDate?: Date | null;
  /** Delays already counted in the database; otherwise deduced from `dueDate`. */
  overdue?: number;
}

/**
 * Load per person. The assignee has always been carried by the API but was displayed nowhere: it was
 * impossible to see who carried what.
 */
export function buildWorkload(rows: WorkloadInput[], now: Date): WorkloadRow[] {
  const out = new Map<number | null, WorkloadRow>();
  for (const input of rows) {
    const family = familyOfRow(input);
    // The load is what remains to be done — neither the work done nor what is out of play.
    if (family === 'done' || family === 'inactive') continue;
    let row = out.get(input.assigneeId);
    if (!row) {
      row = {
        assigneeId: input.assigneeId,
        name: input.assigneeName,
        todo: 0,
        progress: 0,
        review: 0,
        blocked: 0,
        overdue: 0,
        total: 0,
      };
      out.set(input.assigneeId, row);
    }
    const n = countOf(input);
    row[family] += n;
    row.total += n;
    row.overdue +=
      input.overdue ?? (input.dueDate != null && input.dueDate.getTime() < now.getTime() ? n : 0);
  }
  // The most loaded first; tasks with no assignee close the march, whatever their number — it is a gap to
  // fill, not a person to compare with the others.
  return [...out.values()].sort((a, b) => {
    if ((a.assigneeId === null) !== (b.assigneeId === null)) return a.assigneeId === null ? 1 : -1;
    return b.total - a.total;
  });
}

/**
 * A weekly pace point.
 *
 * The unit is carried by the SERIES, not by the point: `pace` counts tasks, `delivery` counts media. That is
 * the whole fix of the pace — the projection divided a remaining amount in tasks
 * by a rate in published media, and announced a project end in 2028. Two named series, two declared units, no
 * division between the two.
 */
export interface WeekPoint {
  /** Monday of the week, in short ISO (YYYY-MM-DD). */
  weekStart: string;
  count: number;
}

/** Monday of the week containing `date`, at midnight UTC. */
export function weekStartOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: 0 = Sunday. We bring it back to the previous Monday.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Weekly series over the requested window, empty weeks included. */
export function buildPace(counts: WeekPoint[], now: Date, weeks: number): WeekPoint[] {
  const start = weekStartOf(now);
  const points: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const week = new Date(start);
    week.setUTCDate(week.getUTCDate() - i * 7);
    points.push({ weekStart: isoDay(week), count: 0 });
  }
  const index = new Map(points.map((p, i) => [p.weekStart, i]));
  for (const point of counts) {
    const slot = index.get(point.weekStart);
    if (slot !== undefined) points[slot]!.count += point.count;
  }
  return points;
}

/**
 * Why there is no projected date.
 *
 * An absent projection must state its reason, otherwise the screen cannot choose between "the production is
 * finished" (good news) and "we do not know" (which must absolutely not be shown
 * as a date).
 */
export type ProjectionUnavailable =
  /** Everything is done: there is nothing to project. */
  | 'nothing-left'
  /** No task crossed over the window: the observed velocity is zero. */
  | 'no-velocity';

export interface Projection {
  /** Counted unit — TASKS, the grain of everything else on the page. */
  unit: 'tasks';
  done: number;
  total: number;
  /** Tasks crossed per week over the window, in the same unit as `done`/`total`. */
  perWeek: number;
  /** Projected completion date, `null` as soon as `unavailable` is set. */
  projectedEnd: string | null;
  unavailable: ProjectionUnavailable | null;
}

/**
 * Projected end, at the observed pace — and in the SAME unit as the remaining work.
 *
 * The remaining work is counted in tasks (`total - done`, read from the matrix); the pace must therefore be
 * too. No task closing date exists in the database: the only crossing date that can be
 * cited is that of the first review approval (`queryPace`). It is a real measure, not an estimate — but it
 * only knows tasks passed through review, which is why the pace is returned next to the date:
 * without it, a date alone would be read as a commitment.
 */
export function projectEnd(done: number, total: number, points: WeekPoint[], now: Date): Projection {
  const crossed = points.reduce((n, p) => n + p.count, 0);
  const perWeek = points.length > 0 ? crossed / points.length : 0;
  const remaining = Math.max(0, total - done);
  const base = { unit: 'tasks' as const, done, total, perWeek };
  if (remaining === 0) return { ...base, projectedEnd: null, unavailable: 'nothing-left' };
  if (perWeek <= 0) return { ...base, projectedEnd: null, unavailable: 'no-velocity' };
  const end = new Date(now.getTime());
  end.setUTCDate(end.getUTCDate() + Math.ceil((remaining / perWeek) * 7));
  return { ...base, projectedEnd: isoDay(end), unavailable: null };
}

export interface ProductionOverview {
  matrix: MatrixCell[];
  sequences: { id: number; code: string }[];
  departments: string[];
  attention: Attention;
  workload: WorkloadRow[];
  /** Velocity, in tasks CROSSED per week — the grain of `projection`. */
  pace: WeekPoint[];
  /** Output rate, in published MEDIA per week. Used for no division. */
  delivery: WeekPoint[];
  projection: Projection;
}

/** Cap of the three attention lists; the totals, for their part, are counted in the database. */
export const ATTENTION_LIMIT = 50;

// ── Database reads ────────────────────────────────────────────────────────────

/** Columns of the customizable status, as an aggregate returns them (null = absent). */
interface StatusColumns {
  isDone: boolean | null;
  isInactive: boolean | null;
  legacyStatus: TaskStatus | null;
}

type MatrixAggregate = StatusColumns & {
  sequenceId: number | null;
  department: string | null;
  status: TaskStatus;
  count: number;
};

type WorkloadAggregate = StatusColumns & {
  assigneeId: number | null;
  assigneeName: string | null;
  status: TaskStatus;
  count: number;
  overdue: number;
};

/** Resolves the family of an aggregate row from its status columns. */
const familyOfAggregate = (row: StatusColumns & { status: TaskStatus }): FamilyOrInactive =>
  familyOf(row.status, statusRefOf(row));

/** A task belongs to the project through its shot OR its asset — never both. */
const taskInProject = (projectId: number): Prisma.TaskWhereInput => ({
  // The work of a hidden item no longer counts in the production statistics: it would skew the progress of a
  // project with shots that nobody sees.
  OR: [
    { shot: { projectId, deletedAt: null, hiddenAt: null } },
    { asset: { projectId, deletedAt: null, hiddenAt: null } },
  ],
});

const attentionSelect = {
  id: true,
  name: true,
  status: true,
  dueDate: true,
  department: true,
  assignee: { select: { id: true, name: true } },
  shot: { select: { code: true, sequenceId: true, sequence: { select: { code: true } } } },
  asset: { select: { name: true } },
  pipelineStatus: { select: { isDone: true, isInactive: true, legacyStatus: true } },
} satisfies Prisma.TaskSelect;

type AttentionRow = Prisma.TaskGetPayload<{ select: typeof attentionSelect }>;

const toProductionTask = (r: AttentionRow): ProductionTask => ({
  id: r.id,
  name: r.name,
  status: r.status,
  family: familyOf(r.status, r.pipelineStatus),
  dueDate: r.dueDate,
  assigneeId: r.assignee?.id ?? null,
  assigneeName: r.assignee?.name ?? null,
  department: r.department,
  sequenceId: r.shot?.sequenceId ?? null,
  sequenceCode: r.shot?.sequence?.code ?? null,
  parentLabel: r.shot?.code ?? r.asset?.name ?? '',
});

/**
 * The three attention lists, bounded IN THE DATABASE.
 *
 * Each query already applies the filter, the order and the limit of its list; their union then goes back
 * through `findAttention`, which re-splits it identically — a task absent from the top of its
 * own list cannot appear in another's.
 */
async function fetchAttentionCandidates(projectId: number, now: Date, limit: number) {
  const base = { AND: [taskInProject(projectId), TASK_OPEN_FILTER] };
  const orderBy: Prisma.TaskOrderByWithRelationInput[] = [{ dueDate: 'asc' }, { id: 'asc' }];
  const [overdue, unassigned, waitingReview] = await Promise.all([
    prisma.task.findMany({
      where: { ...base, dueDate: { lt: now } },
      orderBy,
      take: limit,
      select: attentionSelect,
    }),
    prisma.task.findMany({
      where: { ...base, assigneeId: null },
      orderBy,
      take: limit,
      select: attentionSelect,
    }),
    prisma.task.findMany({
      where: { AND: [...base.AND, TASK_REVIEW_FILTER] },
      orderBy,
      take: limit,
      select: attentionSelect,
    }),
  ]);
  const byId = new Map<number, ProductionTask>();
  for (const row of [...overdue, ...unassigned, ...waitingReview]) byId.set(row.id, toProductionTask(row));
  // Stable order (deadline, then identifier): the following split sorts by deadline and keeps the input order
  // on ties.
  return [...byId.values()].sort(
    (a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || a.id - b.id,
  );
}

/** Cross-tab counted by Postgres: one row per sequence x department x status. */
function queryMatrix(projectId: number): Promise<MatrixAggregate[]> {
  return prisma.$queryRaw<MatrixAggregate[]>`
    SELECT sh."sequenceId"        AS "sequenceId",
           t.department           AS "department",
           t.status::text         AS "status",
           ps."isDone"            AS "isDone",
           ps."isInactive"        AS "isInactive",
           ps."legacyStatus"::text AS "legacyStatus",
           COUNT(*)::int          AS "count"
    FROM "Task" t
    LEFT JOIN "Shot" sh  ON sh.id = t."shotId"  AND sh."deletedAt" IS NULL AND sh."hiddenAt" IS NULL
    LEFT JOIN "Asset" a  ON a.id  = t."assetId" AND a."deletedAt" IS NULL AND a."hiddenAt" IS NULL
    LEFT JOIN "PipelineStatus" ps ON ps.id = t."pipelineStatusId"
    WHERE sh."projectId" = ${projectId} OR a."projectId" = ${projectId}
    GROUP BY 1, 2, 3, 4, 5, 6
  `;
}

/**
 * Load counted by Postgres: one row per person x status, delays included.
 *
 * Dates travel as ISO and are then cast to `timestamp`: the schema's columns are `TIMESTAMP(3)` without a
 * time zone, and directly comparing a `timestamptz` parameter would make the result depend on the
 * session's time zone (the containers run in Europe/Paris).
 */
function queryWorkload(projectId: number, now: Date): Promise<WorkloadAggregate[]> {
  return prisma.$queryRaw<WorkloadAggregate[]>`
    SELECT t."assigneeId"         AS "assigneeId",
           u.name                 AS "assigneeName",
           t.status::text         AS "status",
           ps."isDone"            AS "isDone",
           ps."isInactive"        AS "isInactive",
           ps."legacyStatus"::text AS "legacyStatus",
           COUNT(*)::int          AS "count",
           COUNT(*) FILTER (
             WHERE t."dueDate" IS NOT NULL AND t."dueDate" < ${now.toISOString()}::timestamp
           )::int AS "overdue"
    FROM "Task" t
    LEFT JOIN "Shot" sh  ON sh.id = t."shotId"  AND sh."deletedAt" IS NULL AND sh."hiddenAt" IS NULL
    LEFT JOIN "Asset" a  ON a.id  = t."assetId" AND a."deletedAt" IS NULL AND a."hiddenAt" IS NULL
    LEFT JOIN "User" u   ON u.id  = t."assigneeId"
    LEFT JOIN "PipelineStatus" ps ON ps.id = t."pipelineStatusId"
    WHERE sh."projectId" = ${projectId} OR a."projectId" = ${projectId}
    GROUP BY 1, 2, 3, 4, 5, 6
  `;
}

/**
 * Media published per ISO week (Monday, UTC) — the pipe's OUTPUT rate, in media.
 *
 * Two scope corrections: the trash of the parents was ignored (only `hiddenAt` was checked, never `deletedAt`
 * — the deliveries of a deleted shot therefore inflated the pace), and a media still being
 * encoded counted as delivered. The rest of the service filters both; the pace now does too.
 */
function queryDelivery(projectId: number, since: Date): Promise<WeekPoint[]> {
  return prisma.$queryRaw<WeekPoint[]>`
    SELECT to_char(date_trunc('week', m."createdAt"), 'YYYY-MM-DD') AS "weekStart",
           COUNT(*)::int AS "count"
    FROM "MediaObject" m
    JOIN "Version" v      ON v.id = m."versionId"
    LEFT JOIN "Task" t    ON t.id = v."taskId"
    LEFT JOIN "Shot" sh   ON sh.id = t."shotId"  AND sh."deletedAt" IS NULL AND sh."hiddenAt" IS NULL
    LEFT JOIN "Asset" ta  ON ta.id = t."assetId" AND ta."deletedAt" IS NULL AND ta."hiddenAt" IS NULL
    LEFT JOIN "Asset" va  ON va.id = v."assetId" AND va."deletedAt" IS NULL AND va."hiddenAt" IS NULL
    WHERE m.published = true
      AND m."deletedAt" IS NULL
      AND m.status = 'READY'
      AND v."deletedAt" IS NULL
      AND m."createdAt" >= ${since.toISOString()}::timestamp
      AND (sh."projectId" = ${projectId} OR ta."projectId" = ${projectId} OR va."projectId" = ${projectId})
    GROUP BY 1
  `;
}

/**
 * Tasks crossing their FIRST approval per week — the velocity, in tasks.
 *
 * It is the only crossing date the database can cite: no column says when a task was completed (`updatedAt`
 * moves at each touch-up, and a status has no history). The first review approval is the dated
 * witness: it exists, it is timestamped, it is counted in tasks. `MIN` per task because a retake followed by
 * a second approval does not cross the finish line twice.
 *
 * The project filter is INSIDE the first CTE: outside it, the aggregate would scan all the instance's
 * decisions before retaining a project.
 */
function queryPace(projectId: number, since: Date): Promise<WeekPoint[]> {
  return prisma.$queryRaw<WeekPoint[]>`
    WITH approvals AS (
      SELECT v."taskId" AS task_id, d."createdAt" AS at
      FROM "ReviewDecision" d
      JOIN "Version" v       ON v.id = d."versionId" AND v."deletedAt" IS NULL
      JOIN "ReviewStatus" rs ON rs.id = d."statusId" AND rs."isApproval" = true
      JOIN "Task" t          ON t.id = v."taskId"
      LEFT JOIN "Shot" sh    ON sh.id = t."shotId"  AND sh."deletedAt" IS NULL AND sh."hiddenAt" IS NULL
      LEFT JOIN "Asset" a    ON a.id  = t."assetId" AND a."deletedAt" IS NULL AND a."hiddenAt" IS NULL
      WHERE sh."projectId" = ${projectId} OR a."projectId" = ${projectId}
    ),
    crossed AS (SELECT task_id, MIN(at) AS at FROM approvals GROUP BY 1)
    SELECT to_char(date_trunc('week', at), 'YYYY-MM-DD') AS "weekStart",
           COUNT(*)::int AS "count"
    FROM crossed
    WHERE at >= ${since.toISOString()}::timestamp
    GROUP BY 1
  `;
}

/**
 * The real totals of the three attention lists, plus the de-duplicated badge.
 *
 * Four indexed `count`s rather than a raw aggregate: the three families are already expressed as Prisma
 * filters (`lib/statusFamily`), and restating them in SQL would duplicate the only
 * status → family translation on the server.
 */
async function countAttention(projectId: number, now: Date): Promise<AttentionTotals> {
  const base = [taskInProject(projectId), TASK_OPEN_FILTER];
  const overdueWhere: Prisma.TaskWhereInput = { dueDate: { lt: now } };
  const unassignedWhere: Prisma.TaskWhereInput = { assigneeId: null };
  const [overdue, unassigned, waitingReview, blocking] = await Promise.all([
    prisma.task.count({ where: { AND: [...base, overdueWhere] } }),
    prisma.task.count({ where: { AND: [...base, unassignedWhere] } }),
    prisma.task.count({ where: { AND: [...base, TASK_REVIEW_FILTER] } }),
    prisma.task.count({
      where: { AND: [...base, { OR: [overdueWhere, unassignedWhere, TASK_REVIEW_FILTER] }] },
    }),
  ]);
  return { overdue, unassigned, waitingReview, blocking };
}

/** Full steering view of a project. `weeks` bounds the pace window. */
export async function getOverview(
  projectId: number,
  weeks = 8,
  now = new Date(),
): Promise<ProductionOverview> {
  const since = new Date(now.getTime() - weeks * 7 * 86_400_000);
  const [matrixRows, workloadRows, sequences, paceRows, deliveryRows, candidates, totals] = await Promise.all(
    [
      queryMatrix(projectId),
      queryWorkload(projectId, now),
      prisma.sequence.findMany({
        where: { projectId, deletedAt: null, hiddenAt: null },
        orderBy: { order: 'asc' },
        select: { id: true, code: true },
      }),
      queryPace(projectId, since),
      queryDelivery(projectId, since),
      fetchAttentionCandidates(projectId, now, ATTENTION_LIMIT),
      countAttention(projectId, now),
    ],
  );

  const matrix = buildMatrix(
    matrixRows.map((r) => ({
      sequenceId: r.sequenceId,
      department: r.department,
      status: r.status,
      family: familyOfAggregate(r),
      count: r.count,
    })),
  );
  const workload = buildWorkload(
    workloadRows.map((r) => ({
      assigneeId: r.assigneeId,
      assigneeName: r.assigneeName,
      status: r.status,
      family: familyOfAggregate(r),
      count: r.count,
      overdue: r.overdue,
    })),
    now,
  );
  const pace = buildPace(paceRows, now, weeks);
  // Progress: the matrix already carries the counts, inactive statuses excluded.
  const done = matrix.reduce((n, cell) => n + cell.done, 0);
  const total = matrix.reduce((n, cell) => n + cell.total, 0);

  return {
    matrix,
    sequences,
    // Departments in alphabetical order, without duplicates or empty values. They are read from ALL rows,
    // inactive statuses included: a column of the table must not disappear on the grounds
    // that its only remaining work has been set aside.
    departments: [
      ...new Set(matrixRows.map((r) => r.department).filter((d): d is string => d !== null)),
    ].sort(),
    attention: { ...findAttention(candidates, now, ATTENTION_LIMIT), totals, limit: ATTENTION_LIMIT },
    workload,
    pace,
    delivery: buildPace(deliveryRows, now, weeks),
    // Same unit on both sides of the division: tasks / tasks per week.
    projection: projectEnd(done, total, pace, now),
  };
}
