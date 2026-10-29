// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { decodeCursor, cursorWhere, encodeCursor } from '../lib/pagination';
import { familyOf, type FamilyOrInactive } from '../lib/statusFamily';

/**
 * Production tracking grid (Phase 50, batch 2): shots in rows, departments in columns, one task per cell.
 *
 * This is the view that was requested by "I want to find everything needed for perfect production tracking
 * there": reading at a glance where each shot stands, step by step, who holds it, since when nothing has
 * moved, and whether the step is even on the schedule.
 *
 * Two rules govern the implementation.
 *
 * **Pagination is done PER SHOT, never per task.** A grid row is a shot with all its cells: paginating by
 * task would cut a row in two, and page 2 would return the end of a shot whose header had been lost. The
 * cursor therefore carries `(Shot.order, Shot.id)` — the index `[projectId, deletedAt, order, id]` exists for
 * that.
 *
 * **All the counting stays in the database.** Four indexed reads per page (plus the total and the department
 * reference): the shots, their tasks, the aggregate of versions per task — counts and last activity in a
 * single `groupBy` — and the departments on each shot's schedule. No folding of ten thousand tasks in
 * JavaScript.
 */

/** Hard ceiling of a page. Beyond it, this is no longer a grid but an export. */
export const GRID_MAX_LIMIT = 200;

/** Size served when the caller does not ask for one. */
export const GRID_DEFAULT_LIMIT = 50;

/** A department of the project's reference, in pipe order. */
export interface GridDepartment {
  id: number;
  key: string;
  name: string;
  color: string | null;
  order: number;
}

/** A shot's own status: always a `PipelineStatus`, or nothing. */
export interface GridShotStatus {
  id: number;
  code: string;
  name: string;
  color: string | null;
}

/**
 * A task's status, as a cell displays it.
 *
 * The server writes NO on-screen text: when the task has no customisable status, `name` is empty and `color`
 * null — it is up to the reader to translate `code` (the value of the frozen enum) or `family`. Inventing "In
 * progress" here would freeze the server's language into fourteen catalogues.
 */
export interface GridCellStatus {
  /** Identifier of the `PipelineStatus`, `null` when the task only has the frozen enum. */
  id: number | null;
  /** Code of the studio's status, or the enum value (`IN_PROGRESS`) otherwise. */
  code: string;
  /** Studio label, empty when no customisable status is set. */
  name: string;
  /** Studio tint (#RRGGBB), `null` when no customisable status is set. */
  color: string | null;
  family: FamilyOrInactive;
}

export interface GridCell {
  departmentKey: string;
  taskId: number | null;
  status: GridCellStatus | null;
  assignee: { id: number; name: string | null } | null;
  versionCount: number;
  /** Date of the last version delivered on this task, `null` if none. */
  lastActivityAt: string | null;
  dueDate: string | null;
  /** Is this department on this shot's schedule (`ShotDepartments`)? */
  scheduled: boolean;
}

export interface GridRow {
  shotId: number;
  code: string;
  name: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  episodeId: number | null;
  episodeCode: string | null;
  status: GridShotStatus | null;
  cells: GridCell[];
}

export interface ProjectGrid {
  departments: GridDepartment[];
  rows: GridRow[];
  nextCursor: string | null;
  total: number;
}

/** Filters accepted by the grid. All optional, all cumulative. */
export interface GridFilters {
  cursor?: string;
  limit?: number;
  episodeId?: number;
  sequenceId?: number;
  /** Department key (`comp`), not its label. */
  department?: string;
  assigneeId?: number;
  /** Studio status code, or the frozen enum value for a studio without a reference. */
  status?: string;
}

// ── Filters ──────────────────────────────────────────────────────────────────

const TASK_STATUS_VALUES = new Set<string>(Object.values(TaskStatus));

/**
 * "Does this task carry this status?"
 *
 * The studio's code first; failing a reference, the value of the frozen enum. The two branches are disjoint
 * (`pipelineStatusId: null`): a studio linked to ShotGrid filters on its vocabulary, a studio without a
 * connection on ours, without either needing to know which of the two the API expects.
 */
function statusFilter(status: string): Prisma.TaskWhereInput {
  const branches: Prisma.TaskWhereInput[] = [{ pipelineStatus: { code: status } }];
  const asEnum = status.toUpperCase();
  if (TASK_STATUS_VALUES.has(asEnum)) branches.push({ pipelineStatusId: null, status: asEnum as TaskStatus });
  return { OR: branches };
}

/**
 * Filters that bear on a shot's TASKS. A shot remains an entire row: the filter decides whether it is
 * displayed, never which cells it shows — a grid whose columns empty out on filtering can no longer be read.
 */
export function gridTaskFilter(filters: GridFilters): Prisma.TaskWhereInput | null {
  const clauses: Prisma.TaskWhereInput[] = [];
  if (filters.department)
    clauses.push({
      OR: [{ departmentRef: { key: filters.department } }, { department: filters.department }],
    });
  if (filters.assigneeId !== undefined) clauses.push({ assigneeId: filters.assigneeId });
  if (filters.status) clauses.push(statusFilter(filters.status));
  return clauses.length > 0 ? { AND: clauses } : null;
}

/** `where` of the page's shots — trash and hiding excluded, filters included. */
export function gridShotWhere(projectId: number, filters: GridFilters): Prisma.ShotWhereInput {
  const taskFilter = gridTaskFilter(filters);
  return {
    projectId,
    deletedAt: null,
    hiddenAt: null,
    ...(filters.sequenceId !== undefined ? { sequenceId: filters.sequenceId } : {}),
    // Optional to-one relation: the clause implies that the sequence exists, which automatically excludes
    // shots outside an episode — exactly what "filter by episode" asks.
    ...(filters.episodeId !== undefined ? { sequence: { episodeId: filters.episodeId } } : {}),
    ...(taskFilter ? { tasks: { some: taskFilter } } : {}),
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

const shotSelect = {
  id: true,
  code: true,
  name: true,
  order: true,
  sequenceId: true,
  sequence: { select: { code: true, episodeId: true, episode: { select: { code: true } } } },
  pipelineStatus: { select: { id: true, code: true, name: true, color: true } },
  // Departments on this shot's schedule: this is what distinguishes "nothing to do here" from "to do, not
  // started". One more join on the link table, bounded to the page — not a sweep of the project.
  departments: { select: { id: true } },
} satisfies Prisma.ShotSelect;

const taskSelect = {
  id: true,
  shotId: true,
  status: true,
  dueDate: true,
  department: true,
  departmentId: true,
  departmentRef: { select: { key: true } },
  assignee: { select: { id: true, name: true } },
  pipelineStatus: {
    select: {
      id: true,
      code: true,
      name: true,
      color: true,
      isDone: true,
      isInactive: true,
      legacyStatus: true,
    },
  },
} satisfies Prisma.TaskSelect;

export type GridShotRow = Prisma.ShotGetPayload<{ select: typeof shotSelect }>;
export type GridTaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

/** Aggregate of a task's versions: how many, and the most recent one. */
export interface GridVersionAggregate {
  taskId: number;
  count: number;
  lastAt: Date | null;
}

/**
 * The project's department reference, reduced to what a column displays.
 *
 * Same rule as `DepartmentService.listForProject` — the project's own departments entirely replace those of
 * the studio — but without signing the images: a grid of two hundred rows has no use for twenty presigned
 * URLs.
 */
export async function listGridDepartments(projectId: number): Promise<GridDepartment[]> {
  const select = { id: true, key: true, name: true, color: true, order: true };
  const orderBy = [{ order: 'asc' as const }, { key: 'asc' as const }];
  const own = await prisma.department.findMany({
    where: { projectId, deletedAt: null },
    orderBy,
    select,
  });
  if (own.length > 0) return own;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { studioId: true },
  });
  if (!project) return [];
  return prisma.department.findMany({
    where: { studioId: project.studioId, projectId: null, deletedAt: null },
    orderBy,
    select,
  });
}

// ── Assembly (pure, tested without a database) ───────────────────────────────

/** A task's department key: the relation is authoritative, the denormalised column stands in. */
const taskDepartmentKey = (task: GridTaskRow): string | null =>
  task.departmentRef?.key ?? task.department ?? null;

/** A cell's status, synthesised from the studio's status or, failing that, from the frozen enum. */
export function cellStatusOf(task: GridTaskRow): GridCellStatus {
  const ps = task.pipelineStatus;
  return {
    id: ps?.id ?? null,
    code: ps?.code ?? task.status,
    name: ps?.name ?? '',
    color: ps?.color ?? null,
    family: familyOf(task.status, ps),
  };
}

/**
 * Shots + tasks + aggregates → grid rows.
 *
 * One cell per department of the reference, in pipe order: the grid keeps its columns even when a shot has
 * nothing to do there. When several tasks share a department on the same
 * shot — the unique constraint allows it, the names differ — the cell shows the FIRST in pipe order (`order`,
 * then `id`); tasks whose department does not belong to the reference have
 * no column in which to display themselves.
 */
export function buildGridRows(
  shots: GridShotRow[],
  tasks: GridTaskRow[],
  versions: GridVersionAggregate[],
  departments: GridDepartment[],
): GridRow[] {
  // The case of the denormalised keys is not guaranteed on old rows (the column was a free string before the
  // relation): the index is therefore case-insensitive.
  const byKey = new Map(departments.map((d) => [d.key.toLowerCase(), d]));
  const versionOf = new Map(versions.map((v) => [v.taskId, v]));

  /** shotId → department key → retained task (the first in the order received). */
  const cellTasks = new Map<number, Map<string, GridTaskRow>>();
  for (const task of tasks) {
    if (task.shotId === null) continue;
    const key = taskDepartmentKey(task);
    const department = key ? byKey.get(key.toLowerCase()) : undefined;
    if (!department) continue;
    let perShot = cellTasks.get(task.shotId);
    if (!perShot) {
      perShot = new Map();
      cellTasks.set(task.shotId, perShot);
    }
    if (!perShot.has(department.key)) perShot.set(department.key, task);
  }

  return shots.map((shot) => {
    const perShot = cellTasks.get(shot.id);
    const scheduledIds = new Set(shot.departments.map((d) => d.id));
    return {
      shotId: shot.id,
      code: shot.code,
      name: shot.name,
      sequenceId: shot.sequenceId,
      sequenceCode: shot.sequence?.code ?? null,
      episodeId: shot.sequence?.episodeId ?? null,
      episodeCode: shot.sequence?.episode?.code ?? null,
      status: shot.pipelineStatus,
      cells: departments.map((department) => {
        const task = perShot?.get(department.key);
        const aggregate = task ? versionOf.get(task.id) : undefined;
        return {
          departmentKey: department.key,
          taskId: task?.id ?? null,
          status: task ? cellStatusOf(task) : null,
          assignee: task?.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
          versionCount: aggregate?.count ?? 0,
          lastActivityAt: aggregate?.lastAt ? aggregate.lastAt.toISOString() : null,
          dueDate: task?.dueDate ? task.dueDate.toISOString() : null,
          // An existing task counts as scheduled: it would not have been created otherwise.
          scheduled: scheduledIds.has(department.id) || task !== undefined,
        };
      }),
    };
  });
}

/** A page of the grid. The cursor resumes after the last shot served. */
export async function getProjectGrid(projectId: number, filters: GridFilters = {}): Promise<ProjectGrid> {
  const limit = Math.min(Math.max(1, Math.trunc(filters.limit ?? GRID_DEFAULT_LIMIT)), GRID_MAX_LIMIT);
  const where = gridShotWhere(projectId, filters);
  const cursor = decodeCursor(filters.cursor);
  // The cursor stacks into `AND`: the `where` already carries relation clauses that a spread at the root
  // would overwrite.
  const paged: Prisma.ShotWhereInput = cursor
    ? { ...where, AND: [cursorWhere('order', 'asc', cursor)] }
    : where;

  const [shots, total, departments] = await Promise.all([
    prisma.shot.findMany({
      where: paged,
      // Exactly the sort of the index `[projectId, deletedAt, order, id]`: `id` closes the tie-break,
      // otherwise two shots of equal `order` would change page.
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      take: limit,
      select: shotSelect,
    }),
    prisma.shot.count({ where }),
    listGridDepartments(projectId),
  ]);

  const shotIds = shots.map((s) => s.id);
  const tasks =
    shotIds.length === 0
      ? []
      : await prisma.task.findMany({
          where: { shotId: { in: shotIds } },
          // The index `[shotId, order]` serves the filter AND the sort: it is this order that elects the task
          // of a cell when a department carries several.
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          select: taskSelect,
        });

  const taskIds = tasks.map((t) => t.id);
  const grouped =
    taskIds.length === 0
      ? []
      : await prisma.version.groupBy({
          by: ['taskId'],
          where: { taskId: { in: taskIds }, deletedAt: null },
          _count: { _all: true },
          _max: { createdAt: true },
        });
  const versions: GridVersionAggregate[] = grouped.flatMap((g) =>
    g.taskId === null ? [] : [{ taskId: g.taskId, count: g._count._all, lastAt: g._max.createdAt }],
  );

  const last = shots.at(-1);
  return {
    departments,
    rows: buildGridRows(shots, tasks, versions, departments),
    // An incomplete page closes the list: no need to make the client request an empty page.
    nextCursor: last && shots.length >= limit ? encodeCursor(last.order, last.id) : null,
    total,
  };
}
