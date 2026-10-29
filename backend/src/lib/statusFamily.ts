// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, TaskStatus } from '@prisma/client';

/**
 * Status family: the common vocabulary of all gauges (steering, home page, project
 * progress).
 *
 * Statistics so far reasoned on the frozen `TaskStatus` enum, with six values, while a
 * studio linked to ShotGrid works with the `PipelineStatus` catalog: fifteen statuses per
 * entity, where `isDone` says which are terminal and `isInactive` which count nowhere
 * ("omitted", "n/a", "declined"). Result: wrong gauges on both sides. A "done" shot was
 * not counted as done, and an omitted shot inflated the remaining work indefinitely.
 *
 * This module is the only status-to-family translation on the server. It is pure, so it
 * is tested without a database, and it serves both the SQL fallback (Prisma filters) and
 * the in-memory fallback (folding of aggregates).
 */

export type Family = 'todo' | 'progress' | 'review' | 'done' | 'blocked';

/**
 * "Neither to do nor done". These statuses are displayed but count in no gauge:
 * counting them as remaining work would inflate a production's progress, while counting
 * them as done would flatter it.
 */
export type FamilyOrInactive = Family | 'inactive';

/** Mapping of the frozen enum: the fallback when no custom status is set. */
export const FAMILY_OF_ENUM: Record<TaskStatus, Family> = {
  TODO: 'todo',
  IN_PROGRESS: 'progress',
  PENDING_REVIEW: 'review',
  APPROVED: 'done',
  RETAKE: 'blocked',
  REJECTED: 'blocked',
};

/** The custom status, reduced to what a gauge needs. */
export interface PipelineStatusRef {
  isDone: boolean;
  isInactive: boolean;
  legacyStatus: TaskStatus | null;
}

/**
 * The family of a task.
 *
 * Without a custom status, the enum is authoritative (studio without ShotGrid: behavior
 * unchanged). With one, `isInactive` then `isDone` decide (they are written by the sync
 * precisely for this), and `legacyStatus` serves as a bridge for intermediate families.
 * A non-terminal status can never count as done, even if its bridge claims so: `isDone`
 * is the only authority on "finished".
 */
export function familyOf(status: TaskStatus, pipelineStatus?: PipelineStatusRef | null): FamilyOrInactive {
  if (!pipelineStatus) return FAMILY_OF_ENUM[status];
  if (pipelineStatus.isInactive) return 'inactive';
  if (pipelineStatus.isDone) return 'done';
  const family = FAMILY_OF_ENUM[pipelineStatus.legacyStatus ?? status];
  return family === 'done' ? 'review' : family;
}

/**
 * Builds a status reference from columns read flat (SQL aggregate).
 * A null `isDone` means "no custom status set", not "not done".
 */
export function statusRefOf(row: {
  isDone: boolean | null;
  isInactive: boolean | null;
  legacyStatus: TaskStatus | null;
}): PipelineStatusRef | null {
  if (row.isDone === null) return null;
  return {
    isDone: row.isDone,
    isInactive: row.isInactive ?? false,
    legacyStatus: row.legacyStatus,
  };
}

/** Display order: what requires an action first, what is closed last. */
export const FAMILY_PRIORITY: Record<FamilyOrInactive, number> = {
  blocked: 0,
  review: 1,
  progress: 2,
  todo: 3,
  done: 4,
  inactive: 5,
};

/**
 * Priority of a task in a "what is waiting for me" list.
 *
 * The family decides the block, the enum breaks ties inside it (RETAKE before REJECTED).
 * Without a custom status, the order is exactly the previous one: the family of a
 * historical status is monotonic in the same direction as the enum.
 */
const ENUM_PRIORITY: Record<TaskStatus, number> = {
  RETAKE: 0,
  REJECTED: 1,
  PENDING_REVIEW: 2,
  IN_PROGRESS: 3,
  TODO: 4,
  APPROVED: 5,
};

export function taskPriority(status: TaskStatus, pipelineStatus?: PipelineStatusRef | null): number {
  return FAMILY_PRIORITY[familyOf(status, pipelineStatus)] * 10 + ENUM_PRIORITY[status];
}

// ── Matching Prisma filters ─────────────────────────────────────────────────────
//
// They say in SQL what `familyOf` says in memory, so the database can bound a list
// without first loading the status catalog. Any change to `familyOf` must be reflected
// here: this is the only duplication the module accepts.

/** Neither done nor out of play: the scope of everything that "remains to be done". */
export const TASK_OPEN_FILTER: Prisma.TaskWhereInput = {
  OR: [
    { pipelineStatusId: null, status: { not: TaskStatus.APPROVED } },
    { pipelineStatus: { isDone: false, isInactive: false } },
  ],
};

/** Builds the filter for an intermediate family (review, blocked…). */
function familyFilter(...legacy: TaskStatus[]): Prisma.TaskWhereInput {
  return {
    OR: [
      { pipelineStatusId: null, status: { in: legacy } },
      { pipelineStatus: { isDone: false, isInactive: false, legacyStatus: { in: legacy } } },
      // Custom status without a bridge: the task enum takes over.
      {
        pipelineStatus: { isDone: false, isInactive: false, legacyStatus: null },
        status: { in: legacy },
      },
    ],
  };
}

/** Awaiting a verdict. */
export const TASK_REVIEW_FILTER = familyFilter(TaskStatus.PENDING_REVIEW);

/** What falls to me: a retake or a rejection. */
export const TASK_BLOCKED_FILTER = familyFilter(TaskStatus.RETAKE, TaskStatus.REJECTED);
