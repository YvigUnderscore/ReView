// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { TASK_STATUS_LABEL_KEY } from '../../../lib/taskStatus';
import type { MessageKey, Tr } from '../../../i18n';
import type { StatusFamily } from '../productionWire';

/**
 * The contract of the tracking grid, and the decisions it takes without a DOM.
 *
 * The "Where the project stands" screen crossed sequences and departments, and users judged it incomprehensible: a cell there
 * held an average, none said which shot waited for what, the columns were technical keys sorted alphabetically, and the five
 * colours were named only in a `title` attribute.
 *
 * The grid replaces it at the level of the SHOT. Everything decided without pixels lives here (grouping, collapsed aggregate,
 * visible columns, nature of a cell) so that it can be verified without a browser. The types mirror
 * `backend/src/services/GridService.ts`: when they diverge, it is the service that is right.
 */

/** A department of the reference data, in pipe order. */
export interface GridDepartment {
  id: number;
  key: string;
  name: string;
  /** Tint set by the studio (#RRGGBB): applied as style, never as a class. */
  color: string | null;
  order: number;
}

/** The shot's OWN status: it exists in the database and was displayed nowhere. */
export interface GridShotStatus {
  id: number;
  code: string;
  name: string;
  color: string | null;
}

/**
 * The status of a cell. `name` empty means "the studio has no reference data": the screen must then translate `code`,
 * which carries the value of the frozen enum.
 */
export interface GridCellStatus {
  id: number | null;
  code: string;
  name: string;
  color: string | null;
  family: StatusFamily;
}

export interface GridCell {
  departmentKey: string;
  taskId: number | null;
  status: GridCellStatus | null;
  assignee: { id: number; name: string | null } | null;
  versionCount: number;
  lastActivityAt: string | null;
  dueDate: string | null;
  /** Is this department on the schedule of this shot? */
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

// -- Status families: named on screen, not merely coloured -------------------

/**
 * The order of the legend and of the stacked bars: what is done comes first, what has not started afterwards. A bar that
 * put `todo` at the head would make progress go backwards.
 */
export const FAMILIES: StatusFamily[] = ['done', 'review', 'progress', 'blocked', 'todo', 'inactive'];

/** The name of each family. The keys already exist: the kanban displays them as columns. */
export const FAMILY_LABEL: Record<StatusFamily, MessageKey> = {
  todo: 'kanban.family.todo',
  progress: 'kanban.family.progress',
  review: 'kanban.family.review',
  done: 'kanban.family.done',
  blocked: 'kanban.family.blocked',
  inactive: 'kanban.family.inactive',
};

// -- Name of a status -----------------------------------------------------------

/** Labels of the frozen enum, indexable: an unknown code falls back on its family. */
const LEGACY_LABEL: Record<string, MessageKey | undefined> = TASK_STATUS_LABEL_KEY;

/**
 * The status name, as a cell WRITES it.
 *
 * It is the **name** and not the `code`: a code is short only in a ShotGrid reference (`ip`, `fin`, `rev`). The local
 * vocabulary, the one every instance receives at migration, carries codes like `in_progress` and `pending_review`, longer
 * and less readable than the names "In Progress" and "To Review" that the studio wrote to be read. The name is therefore the
 * right answer in the cell, and the code serves no purpose on screen.
 *
 * Without any reference data at all, the server leaves `name` empty and puts the frozen enum value in `code`: that is an
 * identifier, never a word, and its translated label is rendered.
 */
export function statusName(status: GridCellStatus | null, t: Tr): string {
  if (!status) return t('production.grid.idle');
  if (status.name.trim() !== '') return status.name;
  return t(LEGACY_LABEL[status.code] ?? FAMILY_LABEL[status.family]);
}

/**
 * Length, in characters, of the longest name a cell on the page is going to write.
 *
 * This sets the column widths: one pass over the DATA, once per render, not a text measurement per cell, which would cause
 * twelve hundred layout reads at each scroll step.
 *
 * Only visible columns count: under "hide empty columns", the endless name of a removed department no longer has to widen
 * the grid for everyone.
 */
export function widestStatus(rows: GridRow[], columns: GridDepartment[], t: Tr): number {
  const shown = new Set(columns.map((department) => department.key));
  let longest = 0;
  for (const row of rows) {
    for (const cell of row.cells) {
      // A cell without a task writes nothing: it keeps its ring or its dash.
      if (cell.taskId === null || !shown.has(cell.departmentKey)) continue;
      longest = Math.max(longest, statusName(cell.status, t).length);
    }
  }
  return longest;
}

// -- Filters ------------------------------------------------------------------

/** Shots requested per page. The route caps at 200; 50 fits the screen without saturating it. */
export const GRID_PAGE = 50;

export interface GridFilters {
  episodeId: number | null;
  sequenceId: number | null;
  /** KEY of the department (`comp`), never its label. */
  department: string | null;
  assigneeId: number | null;
  /** Studio status code, or the frozen enum value when there is no reference data. */
  status: string | null;
}

export const NO_FILTERS: GridFilters = {
  episodeId: null,
  sequenceId: null,
  department: null,
  assigneeId: null,
  status: null,
};

export const hasFilters = (filters: GridFilters): boolean =>
  Object.values(filters).some((value) => value !== null);

/**
 * The query string of the route, and, without a cursor, the cache key.
 *
 * One function for both: two writings would eventually diverge, and a page served under another filter's key is a grid showing
 * the neighbour's shots.
 */
export function gridSearch(filters: GridFilters, cursor: string | null, limit = GRID_PAGE): string {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (filters.episodeId !== null) params.set('episodeId', String(filters.episodeId));
  if (filters.sequenceId !== null) params.set('sequenceId', String(filters.sequenceId));
  if (filters.department !== null) params.set('department', filters.department);
  if (filters.assigneeId !== null) params.set('assigneeId', String(filters.assigneeId));
  if (filters.status !== null) params.set('status', filters.status);
  // The cursor comes last: the cache key is exactly the same string without it.
  if (cursor !== null) params.set('cursor', cursor);
  return `?${params.toString()}`;
}

// -- Nature of a cell --------------------------------------------------------

/**
 * Three cells, three meanings, and that is the distinction most lacking.
 *
 * `unscheduled`: the department is not on the shot's schedule, there is nothing to expect from it. `idle`: it is on the
 * schedule, but nobody has created the task yet: that is work to be done. Confusing them used to read "nothing to report"
 * where there was no commitment at all, and vice versa.
 */
export type CellKind = 'unscheduled' | 'idle' | 'task';

export function cellKind(cell: GridCell): CellKind {
  if (cell.taskId !== null) return 'task';
  return cell.scheduled ? 'idle' : 'unscheduled';
}

/** The family of a cell, `idle` included: a to-do cell is a `todo` cell. */
export function cellFamily(cell: GridCell): StatusFamily | null {
  const kind = cellKind(cell);
  if (kind === 'unscheduled') return null;
  return cell.status?.family ?? 'todo';
}

// -- Grouping by sequence ------------------------------------------------------

/** Key of the group of shots that no sequence claims. */
export const NO_SEQUENCE = 'none';

export interface SequenceGroup {
  key: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  episodeCode: string | null;
  rows: GridRow[];
}

/**
 * Shots filed by sequence, in the order the server serves them.
 *
 * An index rather than slicing: nothing guarantees that two shots of the same sequence are consecutive (`Shot.order` is
 * free), and a naive slicing would open two groups bearing the same name.
 */
export function groupBySequence(rows: GridRow[]): SequenceGroup[] {
  const groups = new Map<string, SequenceGroup>();
  for (const row of rows) {
    const key = row.sequenceId === null ? NO_SEQUENCE : String(row.sequenceId);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        sequenceId: row.sequenceId,
        sequenceCode: row.sequenceCode,
        episodeCode: row.episodeCode,
        rows: [],
      };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()];
}

// -- Aggregate of a collapsed group ----------------------------------------------

export interface FamilyTally {
  /** Cells counted: off-schedule ones are not part of it. */
  total: number;
  done: number;
  counts: Record<StatusFamily, number>;
}

const zeroCounts = (): Record<StatusFamily, number> => ({
  todo: 0,
  progress: 0,
  review: 0,
  done: 0,
  blocked: 0,
  inactive: 0,
});

/**
 * The aggregate carried by a collapsed sequence: this is how the sequence level survives the disappearance of the progress
 * matrix. It becomes the collapsed state of the grid.
 *
 * Off-schedule cells are excluded from the denominator: a shot that does not go through compositing must not lower the
 * progress of its sequence.
 */
export function familyTally(rows: GridRow[]): FamilyTally {
  const counts = zeroCounts();
  let total = 0;
  for (const row of rows) {
    for (const cell of row.cells) {
      const family = cellFamily(cell);
      if (family === null) continue;
      counts[family] += 1;
      total += 1;
    }
  }
  return { total, done: counts.done, counts };
}

// -- Visible columns --------------------------------------------------------

/**
 * The columns to show. In "hide empty columns" mode, a department survives only if at least one shot on the page has it on
 * its schedule or carries a task on it: a column where nobody has anything to do does not deserve the width it takes.
 */
export function visibleDepartments(
  departments: GridDepartment[],
  rows: GridRow[],
  hideEmpty: boolean,
): GridDepartment[] {
  if (!hideEmpty) return departments;
  const used = new Set<string>();
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cellKind(cell) !== 'unscheduled') used.add(cell.departmentKey);
    }
  }
  return departments.filter((department) => used.has(department.key));
}

// -- Rows to mount ----------------------------------------------------------

export type GridLine =
  { kind: 'group'; key: string; group: SequenceGroup } | { kind: 'row'; key: string; row: GridRow };

/**
 * The flat list the virtualiser indexes. A collapsed group keeps its header row, since it carries the aggregate, and drops
 * its shots.
 */
export function flattenGrid(groups: SequenceGroup[], collapsed: ReadonlySet<string>): GridLine[] {
  const lines: GridLine[] = [];
  for (const group of groups) {
    lines.push({ kind: 'group', key: `group:${group.key}`, group });
    if (collapsed.has(group.key)) continue;
    for (const row of group.rows) lines.push({ kind: 'row', key: `shot:${row.shotId}`, row });
  }
  return lines;
}
