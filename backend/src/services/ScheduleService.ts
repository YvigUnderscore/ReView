// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, TaskStatus, TaskType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { familyOf, type FamilyOrInactive } from '../lib/statusFamily';

/**
 * Project schedule (43.C, issues #125/#128): dated tasks (due and/or start date) for the calendar
 * view and the per-sequence Gantt. Read-only; date edits go through the existing
 * PATCH /api/tasks/:id (supervisors).
 *
 * **Bounding.** The read used to have no cap: on a feature film (two thousand shots, ten thousand
 * tasks, the volume the repository targets), opening the tab fetched the entire dated project in one
 * JSON response. A calendar is not a list: paginating it by rank would make no sense. The right bound is
 * the **time window** actually displayed (`from`/`to`, optional: when absent, everything is returned as
 * before), doubled by a **safety cap**: beyond it, the first tasks are served and the reader is told that
 * the requested period is too wide (`truncated`).
 */

/**
 * Safety cap, in tasks. This is not a page: it is the point beyond which the response stops being
 * servable (about 500 KB of JSON) and where the right answer is to narrow the window, not to ask for more.
 */
export const SCHEDULE_MAX_TASKS = 2000;

/**
 * The studio's status, as a Gantt bar colours it.
 *
 * The schedule used to paint its bars from the fixed `TaskStatus` enum: six hard-coded colours, none of
 * which is the vocabulary of a studio linked to ShotGrid. A "final" or "awaiting client" task was shown in
 * the tint of a status it does not carry. The tint therefore comes from the reference list when it exists,
 * and `family` says which block the status belongs to, for grouping.
 */
export interface SchedulePipelineStatus {
  id: number;
  code: string;
  name: string;
  /** Hex #RRGGBB as set by the studio. */
  color: string;
}

export interface ScheduleTask {
  id: number;
  name: string;
  type: TaskType;
  status: TaskStatus;
  /** Customizable status, `null` for a studio that has not set one. */
  pipelineStatus: SchedulePipelineStatus | null;
  /** Status family: `todo|progress|review|done|blocked|inactive`. */
  family: FamilyOrInactive;
  startDate: string | null;
  dueDate: string | null;
  location: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  assignee: { id: number; name: string | null } | null;
}

export interface ProjectSchedule {
  tasks: ScheduleTask[];
  /** The cap was reached: the requested window is too wide, tasks are missing. */
  truncated: boolean;
  /** Cap applied, so the reader knows which bound is meant. */
  limit: number;
}

/** Requested time window. Both bounds are independent and optional. */
export interface ScheduleWindow {
  from?: Date;
  to?: Date;
}

/** Raw row (Prisma select output) to schedule task (pure function, tested). */
export interface ScheduleRow {
  id: number;
  name: string;
  type: TaskType;
  status: TaskStatus;
  startDate: Date | null;
  dueDate: Date | null;
  assignee: { id: number; name: string | null } | null;
  shot: { code: string; sequence: { id: number; code: string } | null } | null;
  asset: { name: string } | null;
  pipelineStatus: {
    id: number;
    code: string;
    name: string;
    color: string;
    isDone: boolean;
    isInactive: boolean;
    legacyStatus: TaskStatus | null;
  } | null;
}

export function toScheduleTask(t: ScheduleRow): ScheduleTask {
  const seq = t.shot?.sequence ?? null;
  const location = t.shot ? `${seq ? seq.code + ' · ' : ''}${t.shot.code}` : (t.asset?.name ?? '');
  const ps = t.pipelineStatus;
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    status: t.status,
    pipelineStatus: ps ? { id: ps.id, code: ps.code, name: ps.name, color: ps.color } : null,
    family: familyOf(t.status, ps),
    startDate: t.startDate ? t.startDate.toISOString() : null,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    location,
    sequenceId: seq?.id ?? null,
    sequenceCode: seq?.code ?? null,
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
  };
}

/**
 * Window clauses, as intervals rather than point dates.
 *
 * A task occupies `[effective start, effective end]`, where a missing bound is taken from the other one:
 * this is exactly the rule the Gantt already applies on screen (`spanOf`). It falls within the window if
 * the two intervals overlap: effective end >= `from` **and** effective start <= `to`. Filtering on the due
 * date alone would drop a task that started before the window and is due after it, that is, precisely the
 * tasks in progress at the moment being viewed.
 *
 * `{ dueDate: null, startDate: ... }` reads as AND (sibling fields of the same Prisma object); since an SQL
 * comparison with NULL is false, the two branches are indeed disjoint.
 */
export function scheduleWindowFilter(window: ScheduleWindow): Prisma.TaskWhereInput[] {
  const clauses: Prisma.TaskWhereInput[] = [];
  if (window.from) {
    clauses.push({
      OR: [{ dueDate: { gte: window.from } }, { dueDate: null, startDate: { gte: window.from } }],
    });
  }
  if (window.to) {
    clauses.push({
      OR: [{ startDate: { lte: window.to } }, { startDate: null, dueDate: { lte: window.to } }],
    });
  }
  return clauses;
}

/** Dated project tasks within the requested window, sorted by due date. */
export async function getProjectSchedule(
  projectId: number,
  window: ScheduleWindow = {},
): Promise<ProjectSchedule> {
  const rows = await prisma.task.findMany({
    where: {
      AND: [
        { OR: [{ startDate: { not: null } }, { dueDate: { not: null } }] },
        {
          OR: [{ shot: { projectId, deletedAt: null } }, { asset: { projectId, deletedAt: null } }],
        },
        ...scheduleWindowFilter(window),
      ],
    },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      startDate: true,
      dueDate: true,
      assignee: { select: { id: true, name: true } },
      shot: { select: { code: true, sequence: { select: { id: true, code: true } } } },
      asset: { select: { name: true } },
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
    },
    // `id` closes the sort: without a tie-break, two tasks with the same dates come out in an order
    // that PostgreSQL does not guarantee, and what falls under the cap would change from one call to
    // the next. A truncation must be reproducible.
    //
    // This sort also decides what a truncation leaves out: PostgreSQL puts NULLs last in an ascending sort,
    // so tasks without a due date (the ones only the Gantt displays) come first. That is the lesser evil:
    // the calendar only reads `dueDate`.
    orderBy: [{ dueDate: 'asc' }, { startDate: 'asc' }, { id: 'asc' }],
    // One row more than the cap: it only tells whether there were others, which avoids an extra `count`.
    take: SCHEDULE_MAX_TASKS + 1,
  });

  const truncated = rows.length > SCHEDULE_MAX_TASKS;
  const kept = truncated ? rows.slice(0, SCHEDULE_MAX_TASKS) : rows;
  return { tasks: kept.map(toScheduleTask), truncated, limit: SCHEDULE_MAX_TASKS };
}
