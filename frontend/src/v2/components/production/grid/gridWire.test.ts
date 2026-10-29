// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  FAMILIES,
  FAMILY_LABEL,
  NO_FILTERS,
  NO_SEQUENCE,
  cellFamily,
  cellKind,
  familyTally,
  flattenGrid,
  gridSearch,
  groupBySequence,
  hasFilters,
  statusName,
  visibleDepartments,
  widestStatus,
  type GridCell,
  type GridCellStatus,
  type GridDepartment,
  type GridRow,
} from './gridWire';
import { t } from '../../../i18n';
import type { StatusFamily } from '../productionWire';

/**
 * What the grid decides without pixels.
 *
 * Three decisions are worth locking down here rather than on screen: the distinction between "to do" and "not on the
 * schedule" (the earlier screen confused them), the aggregate of a collapsed group (which replaces the progress matrix), and
 * the cache key, an error in which would serve one filter's page under another's.
 */

const department = (key: string, order: number): GridDepartment => ({
  id: order,
  key,
  name: key.toUpperCase(),
  color: null,
  order,
});

const DEPARTMENTS = [department('anim', 1), department('comp', 2), department('light', 3)];

/** A cell with a task, in the requested family. */
const task = (key: string, family: StatusFamily): GridCell => ({
  departmentKey: key,
  taskId: 100 + key.length,
  status: { id: 1, code: 'IN_PROGRESS', name: 'In progress', color: null, family },
  assignee: null,
  versionCount: 0,
  lastActivityAt: null,
  dueDate: null,
  scheduled: true,
});

/** A cell on the schedule, with no task: work to be done. */
const idle = (key: string): GridCell => ({
  departmentKey: key,
  taskId: null,
  status: null,
  assignee: null,
  versionCount: 0,
  lastActivityAt: null,
  dueDate: null,
  scheduled: true,
});

/** A cell whose department is not on the shot's schedule. */
const offPlan = (key: string): GridCell => ({ ...idle(key), scheduled: false });

/** A cell with a task carrying exactly this status. */
const withStatus = (key: string, status: GridCellStatus): GridCell => ({ ...task(key, 'progress'), status });

/** The status of a studio WITHOUT reference data: the server leaves `name` empty and puts the enum in `code`. */
const legacy = (code: string, family: StatusFamily): GridCellStatus => ({
  id: null,
  code,
  name: '',
  color: null,
  family,
});

const row = (shotId: number, sequenceId: number | null, cells: GridCell[]): GridRow => ({
  shotId,
  code: `SH${shotId}`,
  name: `Shot ${shotId}`,
  sequenceId,
  sequenceCode: sequenceId === null ? null : `SQ${sequenceId}`,
  episodeId: null,
  episodeCode: null,
  status: null,
  cells,
});

describe('cellKind / cellFamily', () => {
  it('distinguishes a task, a to-do cell and an off-schedule cell', () => {
    expect(cellKind(task('comp', 'progress'))).toBe('task');
    expect(cellKind(idle('comp'))).toBe('idle');
    expect(cellKind(offPlan('comp'))).toBe('unscheduled');
  });

  it('counts a to-do cell as "todo" and does not count the off-schedule one', () => {
    expect(cellFamily(idle('comp'))).toBe('todo');
    expect(cellFamily(offPlan('comp'))).toBeNull();
  });

  it("keeps the server's family when the task exists", () => {
    expect(cellFamily(task('comp', 'blocked'))).toBe('blocked');
  });
});

describe('statusName', () => {
  it('writes the NAME from the reference data, not its code: "pending_review" is not a word', () => {
    const status: GridCellStatus = {
      id: 4,
      code: 'pending_review',
      name: 'To Review',
      color: '#F59E0B',
      family: 'review',
    };
    expect(statusName(status, t)).toBe('To Review');
  });

  it('translates the frozen enum when the studio has no reference data', () => {
    expect(statusName(legacy('PENDING_REVIEW', 'review'), t)).toBe(t('task.status.toReview'));
    expect(statusName(legacy('IN_PROGRESS', 'progress'), t)).toBe(t('task.status.inProgress'));
  });

  it('falls back on the family for a code the catalogue does not know', () => {
    expect(statusName(legacy('ON_HOLD', 'blocked'), t)).toBe(t('kanban.family.blocked'));
  });

  it('never renders an identifier on screen', () => {
    for (const status of [legacy('PENDING_REVIEW', 'review'), legacy('ON_HOLD', 'blocked')]) {
      expect(statusName(status, t)).not.toContain('_');
      expect(statusName(status, t)).not.toContain('.');
    }
  });

  it('names the cell without a status instead of leaving it silent', () => {
    expect(statusName(null, t)).toBe(t('production.grid.idle'));
  });
});

describe('widestStatus', () => {
  it('measures the longest name among the cells with a task', () => {
    const rows = [
      row(1, 10, [
        withStatus('anim', { id: 1, code: 'fin', name: 'Final', color: null, family: 'done' }),
        withStatus('comp', { id: 2, code: 'rev', name: 'Pending Review', color: null, family: 'review' }),
      ]),
    ];
    expect(widestStatus(rows, DEPARTMENTS, t)).toBe('Pending Review'.length);
  });

  it('ignores cells without a task: they write nothing', () => {
    const rows = [row(1, 10, [idle('anim'), offPlan('comp')])];
    expect(widestStatus(rows, DEPARTMENTS, t)).toBe(0);
  });

  it('counts only visible columns: a hidden column no longer widens the grid', () => {
    const rows = [
      row(1, 10, [
        withStatus('anim', { id: 1, code: 'fin', name: 'Final', color: null, family: 'done' }),
        withStatus('light', {
          id: 3,
          code: 'apr',
          name: 'Pending Client Approval',
          color: null,
          family: 'review',
        }),
      ]),
    ];
    expect(widestStatus(rows, DEPARTMENTS, t)).toBe('Pending Client Approval'.length);
    expect(widestStatus(rows, [DEPARTMENTS[0]], t)).toBe('Final'.length);
  });
});

describe('FAMILY_LABEL', () => {
  it('names the six families: the legend cannot leave one without a word', () => {
    for (const family of FAMILIES) expect(FAMILY_LABEL[family]).toMatch(/^kanban\.family\./);
    expect(new Set(FAMILIES).size).toBe(6);
  });
});

describe('gridSearch', () => {
  it('carries only the limit when no filter is set', () => {
    expect(gridSearch(NO_FILTERS, null)).toBe('?limit=50');
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it('combines the filters and puts the cursor last', () => {
    const filters = { ...NO_FILTERS, sequenceId: 4, department: 'comp', status: 'IN_PROGRESS' };
    expect(hasFilters(filters)).toBe(true);
    expect(gridSearch(filters, null)).toBe('?limit=50&sequenceId=4&department=comp&status=IN_PROGRESS');
    // The cache key is exactly the same string, with the cursor removed.
    expect(gridSearch(filters, 'abc')).toBe(`${gridSearch(filters, null)}&cursor=abc`);
  });

  it("keeps two different filters apart, otherwise a page would be served under the other's key", () => {
    expect(gridSearch({ ...NO_FILTERS, assigneeId: 1 }, null)).not.toBe(
      gridSearch({ ...NO_FILTERS, assigneeId: 2 }, null),
    );
  });
});

describe('groupBySequence', () => {
  it('gathers the shots of the same sequence even when they are not consecutive', () => {
    const rows = [row(1, 10, []), row(2, 11, []), row(3, 10, [])];
    const groups = groupBySequence(rows);
    expect(groups.map((g) => g.key)).toEqual(['10', '11']);
    expect(groups[0].rows.map((r) => r.shotId)).toEqual([1, 3]);
  });

  it('puts the shots without a sequence in a separate group', () => {
    const groups = groupBySequence([row(1, null, [])]);
    expect(groups[0].key).toBe(NO_SEQUENCE);
    expect(groups[0].sequenceCode).toBeNull();
  });
});

describe('familyTally', () => {
  it('aggregates the families and excludes off-schedule cells from the denominator', () => {
    const rows = [
      row(1, 10, [task('anim', 'done'), task('comp', 'progress'), offPlan('light')]),
      row(2, 10, [task('anim', 'done'), idle('comp'), offPlan('light')]),
    ];
    const tally = familyTally(rows);
    expect(tally.total).toBe(4);
    expect(tally.done).toBe(2);
    expect(tally.counts.progress).toBe(1);
    expect(tally.counts.todo).toBe(1);
  });

  it('renders a zero total when everything is off-schedule', () => {
    expect(familyTally([row(1, 10, [offPlan('anim')])]).total).toBe(0);
  });
});

describe('visibleDepartments', () => {
  const rows = [row(1, 10, [task('anim', 'done'), idle('comp'), offPlan('light')])];

  it('keeps all the columns by default', () => {
    expect(visibleDepartments(DEPARTMENTS, rows, false)).toHaveLength(3);
  });

  it('removes the column that no shot has on its schedule', () => {
    expect(visibleDepartments(DEPARTMENTS, rows, true).map((d) => d.key)).toEqual(['anim', 'comp']);
  });
});

describe('flattenGrid', () => {
  const groups = groupBySequence([row(1, 10, []), row(2, 10, []), row(3, 11, [])]);

  it('mounts the group header, then its shots', () => {
    expect(flattenGrid(groups, new Set()).map((l) => l.key)).toEqual([
      'group:10',
      'shot:1',
      'shot:2',
      'group:11',
      'shot:3',
    ]);
  });

  it('keeps the header of a collapsed group and drops its shots', () => {
    expect(flattenGrid(groups, new Set(['10'])).map((l) => l.key)).toEqual([
      'group:10',
      'group:11',
      'shot:3',
    ]);
  });
});
