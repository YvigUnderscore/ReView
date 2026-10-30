// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../i18n';
import type { TaskStatus } from '../../types/api';
import { TASK_STATUSES, TASK_STATUS_LABEL_KEY } from '../../lib/taskStatus';

/**
 * Kanban columns, built on the project's reference data (C4).
 *
 * The board displayed the six fixed values of the enumeration. A ShotGrid site commonly defines
 * fifteen: dropping a card in "Approved" wrote the first status of the reference data carrying
 * that enum, and the studio found "Waiting to Start" where it had put "On Hold". The columns
 * therefore come from the project's real vocabulary.
 *
 * Fifteen columns side by side cannot be read. They are grouped into five collapsible families,
 * derived from `legacyStatus`: the only piece of information every status already carries,
 * whatever its name on the site.
 */

export type FamilyKey = 'todo' | 'progress' | 'review' | 'done' | 'blocked';

export const FAMILY_ORDER: readonly FamilyKey[] = ['todo', 'progress', 'review', 'done', 'blocked'];

export const FAMILY_LABEL_KEY: Record<FamilyKey, MessageKey> = {
  todo: 'kanban.family.todo',
  progress: 'kanban.family.progress',
  review: 'kanban.family.review',
  done: 'kanban.family.done',
  blocked: 'kanban.family.blocked',
};

/** Which family a value of the enumeration belongs to. */
const FAMILY_OF: Record<TaskStatus, FamilyKey> = {
  TODO: 'todo',
  IN_PROGRESS: 'progress',
  PENDING_REVIEW: 'review',
  APPROVED: 'done',
  RETAKE: 'blocked',
  REJECTED: 'blocked',
};

export function familyOf(legacy: TaskStatus | null | undefined): FamilyKey {
  return legacy ? FAMILY_OF[legacy] : 'todo';
}

/** A status of the reference data, as the board handles it. */
export interface ColumnStatus {
  id: number;
  name: string;
  code: string;
  color: string | null;
  legacyStatus: TaskStatus | null;
}

export interface Column {
  /** Drop-zone identifier: that of the reference data, or the enumeration value. */
  id: string;
  label: string;
  /** Present when the column comes from the project's reference data. */
  statusId: number | null;
  legacyStatus: TaskStatus;
  color: string | null;
  family: FamilyKey;
}

export interface FamilyGroup {
  key: FamilyKey;
  columns: Column[];
}

/**
 * The project's columns, ordered by family, then by reference-data order.
 * Without reference data (a standalone studio that never customized anything), falls back to
 * the six fixed values, which is exactly what the studio sees elsewhere.
 */
export function buildColumns(statuses: ColumnStatus[], t: (key: MessageKey) => string): Column[] {
  if (statuses.length === 0) {
    return TASK_STATUSES.map((legacy) => ({
      id: legacy,
      label: t(TASK_STATUS_LABEL_KEY[legacy]),
      statusId: null,
      legacyStatus: legacy,
      color: null,
      family: familyOf(legacy),
    }));
  }
  const columns = statuses.map((s) => ({
    id: String(s.id),
    label: s.name,
    statusId: s.id,
    legacyStatus: s.legacyStatus ?? 'TODO',
    color: s.color,
    family: familyOf(s.legacyStatus),
  }));
  // Stable sort by family: the reference order is kept within each family.
  return columns
    .map((c, index) => ({ c, index }))
    .sort((a, b) => FAMILY_ORDER.indexOf(a.c.family) - FAMILY_ORDER.indexOf(b.c.family) || a.index - b.index)
    .map(({ c }) => c);
}

/** Groups the visible columns by family; a family without a column disappears. */
export function groupByFamily(columns: Column[], hidden: ReadonlySet<string>): FamilyGroup[] {
  const groups: FamilyGroup[] = [];
  for (const family of FAMILY_ORDER) {
    const cols = columns.filter((c) => c.family === family && !hidden.has(c.id));
    if (cols.length > 0) groups.push({ key: family, columns: cols });
  }
  return groups;
}

/** The column of a task: its reference-data status, otherwise its enumeration value. */
export function columnIdOf(
  task: { pipelineStatusId: number | null; status: TaskStatus },
  columns: Column[],
): string | null {
  if (task.pipelineStatusId != null) {
    const byId = columns.find((c) => c.statusId === task.pipelineStatusId);
    if (byId) return byId.id;
  }
  // The task's status is not offered to the project (a status from another site, or a hidden
  // column). It goes into the first column with the same enumeration value rather than
  // disappearing from the board.
  return columns.find((c) => c.legacyStatus === task.status)?.id ?? null;
}
