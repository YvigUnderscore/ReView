// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS,
  activeCount,
  applyFilters,
  fromRecord,
  matches,
  toRecord,
  type EntityFilterState,
  type Filterable,
} from './entityFilters';

const filters = (over: Partial<EntityFilterState> = {}): EntityFilterState => ({
  ...EMPTY_FILTERS,
  ...over,
});
const item = (over: Partial<Filterable> = {}): Filterable => ({ text: 'SH010 comp', ...over });

describe('activeCount', () => {
  it('counts only the criteria that are set', () => {
    expect(activeCount(EMPTY_FILTERS)).toBe(0);
    expect(activeCount(filters({ text: 'sh', assignee: 'none' }))).toBe(2);
  });
});

describe('toRecord / fromRecord', () => {
  it('omits empty criteria when saving', () => {
    expect(toRecord(filters({ status: '4' }))).toEqual({ status: '4' });
  });

  it('reads a view back, ignoring what it does not know', () => {
    expect(fromRecord({ status: '4', inconnu: 'x' })).toEqual(filters({ status: '4' }));
  });

  it('round-trips without losing anything', () => {
    const f = filters({ text: 'roof', assignee: '7', sequence: 'none' });
    expect(fromRecord(toRecord(f))).toEqual(f);
  });
});

describe('matches', () => {
  it('lets everything through without a criterion', () => {
    expect(matches(EMPTY_FILTERS, item())).toBe(true);
  });

  it('searches the text ignoring case and surrounding spaces', () => {
    expect(matches(filters({ text: '  COMP ' }), item())).toBe(true);
    expect(matches(filters({ text: 'anim' }), item())).toBe(false);
  });

  it('distinguishes "all", "none" and a specific value', () => {
    expect(matches(filters({ assignee: '' }), item({ assigneeId: null }))).toBe(true);
    expect(matches(filters({ assignee: 'none' }), item({ assigneeId: null }))).toBe(true);
    expect(matches(filters({ assignee: 'none' }), item({ assigneeId: 7 }))).toBe(false);
    expect(matches(filters({ assignee: '7' }), item({ assigneeId: 7 }))).toBe(true);
    expect(matches(filters({ assignee: '7' }), item({ assigneeId: 8 }))).toBe(false);
  });

  it('filters out-of-sequence and no-department the same way', () => {
    expect(matches(filters({ sequence: 'none' }), item({ sequenceId: null }))).toBe(true);
    expect(matches(filters({ department: 'none' }), item({ departmentId: 3 }))).toBe(false);
  });

  it('recognises an entity that goes through several departments', () => {
    // A shot or an asset does not belong to *one* department: it goes through several.
    // Comparing with a single identifier never matched, and the screen emptied the list
    // as soon as a department was picked.
    expect(matches(filters({ department: '3' }), item({ departmentIds: [1, 3] }))).toBe(true);
    expect(matches(filters({ department: '4' }), item({ departmentIds: [1, 3] }))).toBe(false);
    // "No department" cannot designate an entity that goes through some.
    expect(matches(filters({ department: 'none' }), item({ departmentIds: [1] }))).toBe(false);
    // Empty list: fall back on the single field, for entities that do not carry any.
    expect(matches(filters({ department: '3' }), item({ departmentIds: [], departmentId: 3 }))).toBe(true);
  });

  it("keeps the kanban's single department, where the filtered row is a task", () => {
    // A task indeed belongs to *one* step: the kanban only fills this field, and the list of
    // steps traversed makes no sense for it.
    expect(matches(filters({ department: '3' }), item({ departmentId: 3 }))).toBe(true);
    expect(matches(filters({ department: '3' }), item({ departmentId: 4 }))).toBe(false);
  });

  it('"no department" designates the entity that goes through none', () => {
    expect(matches(filters({ department: 'none' }), item({ departmentIds: [] }))).toBe(true);
    expect(matches(filters({ department: 'none' }), item({ departmentId: null }))).toBe(true);
  });

  it('excludes the entity whose screen did not supply the departments', () => {
    // An absent field means "none", not "unknown": that is what emptied the lists as long as the API
    // did not return the steps. The contract is therefore that the screen fills in every criterion
    // it offers — the guard is here to remind of it.
    expect(matches(filters({ department: '3' }), item())).toBe(false);
  });

  it('compares the status against the project catalogue first', () => {
    expect(matches(filters({ status: '12' }), item({ statusId: 12 }))).toBe(true);
    expect(matches(filters({ status: '12' }), item({ statusId: 13 }))).toBe(false);
  });

  it('falls back to the enum for an entity without a custom status', () => {
    // An old task only carries "IN_PROGRESS": without this fallback it would disappear as soon
    // as a status filter is set.
    expect(matches(filters({ status: 'IN_PROGRESS' }), item({ legacyStatus: 'IN_PROGRESS' }))).toBe(true);
    expect(matches(filters({ status: 'TODO' }), item({ legacyStatus: 'IN_PROGRESS' }))).toBe(false);
  });

  it('does not confuse "no status" with a set status', () => {
    expect(matches(filters({ status: 'none' }), item({ statusId: null }))).toBe(true);
    expect(matches(filters({ status: 'none' }), item({ statusId: 4 }))).toBe(false);
  });

  it('requires that all criteria pass together', () => {
    const f = filters({ text: 'sh010', assignee: '7' });
    expect(matches(f, item({ assigneeId: 7 }))).toBe(true);
    expect(matches(f, item({ assigneeId: 8 }))).toBe(false);
  });
});

describe('applyFilters', () => {
  const rows = [
    { id: 1, code: 'SH010', assigneeId: 7 },
    { id: 2, code: 'SH020', assigneeId: null },
  ];
  const toFilterable = (r: (typeof rows)[number]): Filterable => ({
    text: r.code,
    assigneeId: r.assigneeId,
  });

  it('returns the list as is when nothing is filtered — same reference', () => {
    expect(applyFilters(EMPTY_FILTERS, rows, toFilterable)).toBe(rows);
  });

  it('filters on the criteria that are set', () => {
    expect(applyFilters(filters({ assignee: 'none' }), rows, toFilterable).map((r) => r.id)).toEqual([2]);
  });
});
