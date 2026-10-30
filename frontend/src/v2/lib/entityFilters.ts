// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared filters for the project lists (C4): kanban, Shots, Assets.
 *
 * The last two had neither filter nor search: on a feature film — two thousand shots, a thousand
 * assets — there was no way to find anything other than scrolling. The kanban had its own three
 * filters, incompatible with the saved views of the rest of the application.
 *
 * An empty filter means "all"; the value `none` means "none" (no assignee, out of sequence, no
 * department) — it is a full answer in its own right, not an absence.
 */

export const NONE = 'none';

/** Set of filters, serialisable as is in a saved view. */
export interface EntityFilterState {
  /** Free search on the name, the code and the parent. */
  text: string;
  status: string;
  assignee: string;
  sequence: string;
  department: string;
  type: string;
}

export const EMPTY_FILTERS: EntityFilterState = {
  text: '',
  status: '',
  assignee: '',
  sequence: '',
  department: '',
  type: '',
};

/** Is a filter active? Used for the displayed count and to enable "clear". */
export function activeCount(filters: EntityFilterState): number {
  return Object.values(filters).filter((v) => v !== '').length;
}

/** Towards the shape of saved views (key → value, empty ones omitted). */
export function toRecord(filters: EntityFilterState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) if (v !== '') out[k] = v;
  return out;
}

/** From a saved view: unknown keys are ignored, absent ones emptied. */
export function fromRecord(record: Record<string, string>): EntityFilterState {
  const out = { ...EMPTY_FILTERS };
  for (const key of Object.keys(EMPTY_FILTERS) as (keyof EntityFilterState)[]) {
    const value = record[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * What an entity offers to filtering.
 *
 * An absent field means "no value", not "unknown": it is therefore disqualifying as soon as a
 * criterion applies to it. A screen must fill in here every criterion it offers in its filter bar —
 * otherwise choosing that criterion empties the list.
 */
export interface Filterable {
  text: string;
  statusId?: number | null;
  legacyStatus?: string | null;
  assigneeId?: number | null;
  sequenceId?: number | null;
  departmentId?: number | null;
  /**
   * The steps the entity goes through.
   *
   * A shot or an asset does not belong to *one* department: it goes through several, one task per
   * step. Filtering on a single `departmentId` could therefore never match — the screen emptied the
   * list as soon as a department was picked.
   */
  departmentIds?: number[];
  department?: string | null;
  type?: string | null;
}

/** An "identifier" criterion: empty = all, `none` = none, otherwise equality on the value. */
function matchId(filter: string, value: number | null | undefined): boolean {
  if (filter === '') return true;
  if (filter === NONE) return value == null;
  return String(value ?? '') === filter;
}

/**
 * The department matches if the entity carries it directly, or if it appears among the steps the
 * entity goes through.
 */
function matchDepartment(filter: string, item: Filterable): boolean {
  if (filter === '') return true;
  const ids = item.departmentIds;
  if (ids && ids.length > 0) {
    if (filter === NONE) return false;
    return ids.some((id) => String(id) === filter);
  }
  return matchId(filter, item.departmentId);
}

export function matches(filters: EntityFilterState, item: Filterable): boolean {
  if (filters.text !== '' && !item.text.toLowerCase().includes(filters.text.trim().toLowerCase())) {
    return false;
  }
  if (!matchId(filters.assignee, item.assigneeId)) return false;
  if (!matchId(filters.sequence, item.sequenceId)) return false;
  if (!matchDepartment(filters.department, item)) return false;
  if (filters.type !== '' && (item.type ?? '') !== filters.type) return false;
  if (filters.status !== '') {
    // The status is first compared against the project catalogue; the enum only serves
    // for old entities, which never received a custom status.
    if (filters.status === NONE) return item.statusId == null;
    const byId = item.statusId != null && String(item.statusId) === filters.status;
    const byLegacy = item.statusId == null && item.legacyStatus === filters.status;
    if (!byId && !byLegacy) return false;
  }
  return true;
}

export function applyFilters<T>(
  filters: EntityFilterState,
  items: T[],
  toFilterable: (item: T) => Filterable,
): T[] {
  if (activeCount(filters) === 0) return items;
  return items.filter((item) => matches(filters, toFilterable(item)));
}
