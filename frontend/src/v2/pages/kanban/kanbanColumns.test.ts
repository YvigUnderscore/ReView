// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { buildColumns, columnIdOf, familyOf, groupByFamily, type ColumnStatus } from './kanbanColumns';
import type { MessageKey } from '../../i18n';

const t = (key: MessageKey) => key;

const status = (over: Partial<ColumnStatus> & { id: number }): ColumnStatus => ({
  name: `S${over.id}`,
  code: `s${over.id}`,
  color: null,
  legacyStatus: 'TODO',
  ...over,
});

describe('familyOf', () => {
  it('places each value of the enumeration in its family', () => {
    expect(familyOf('TODO')).toBe('todo');
    expect(familyOf('IN_PROGRESS')).toBe('progress');
    expect(familyOf('PENDING_REVIEW')).toBe('review');
    expect(familyOf('APPROVED')).toBe('done');
    expect(familyOf('RETAKE')).toBe('blocked');
    expect(familyOf('REJECTED')).toBe('blocked');
  });

  it('places a status with no equivalent in "to do" rather than nowhere', () => {
    expect(familyOf(null)).toBe('todo');
  });
});

describe('buildColumns', () => {
  it('falls back to the six fixed values when the project has no reference data', () => {
    const columns = buildColumns([], t);
    expect(columns).toHaveLength(6);
    expect(columns.every((c) => c.statusId === null)).toBe(true);
    expect(columns[0].id).toBe('TODO');
  });

  it('builds the columns from the project vocabulary', () => {
    const columns = buildColumns(
      [
        status({ id: 10, name: 'Waiting to Start', legacyStatus: 'TODO' }),
        status({ id: 11, name: 'On Hold', legacyStatus: 'TODO' }),
        status({ id: 12, name: 'Supervisor Approved', legacyStatus: 'APPROVED' }),
      ],
      t,
    );
    expect(columns.map((c) => c.label)).toEqual(['Waiting to Start', 'On Hold', 'Supervisor Approved']);
    expect(columns.map((c) => c.id)).toEqual(['10', '11', '12']);
  });

  it('orders by family without mixing up the reference order', () => {
    const columns = buildColumns(
      [
        status({ id: 1, legacyStatus: 'APPROVED' }),
        status({ id: 2, legacyStatus: 'TODO' }),
        status({ id: 3, legacyStatus: 'APPROVED' }),
        status({ id: 4, legacyStatus: 'IN_PROGRESS' }),
      ],
      t,
    );
    // to do → in progress → done, and "1 before 3" within "done".
    expect(columns.map((c) => c.id)).toEqual(['2', '4', '1', '3']);
  });
});

describe('groupByFamily', () => {
  const columns = buildColumns(
    [
      status({ id: 1, legacyStatus: 'TODO' }),
      status({ id: 2, legacyStatus: 'IN_PROGRESS' }),
      status({ id: 3, legacyStatus: 'IN_PROGRESS' }),
    ],
    t,
  );

  it('renders only the families that have a column', () => {
    expect(groupByFamily(columns, new Set()).map((g) => g.key)).toEqual(['todo', 'progress']);
  });

  it('removes hidden columns, and the family with them when it empties', () => {
    expect(groupByFamily(columns, new Set(['1'])).map((g) => g.key)).toEqual(['progress']);
    expect(groupByFamily(columns, new Set(['2'])).flatMap((g) => g.columns.map((c) => c.id))).toEqual([
      '1',
      '3',
    ]);
  });
});

describe('columnIdOf', () => {
  const columns = buildColumns(
    [
      status({ id: 10, legacyStatus: 'TODO' }),
      status({ id: 11, legacyStatus: 'TODO' }),
      status({ id: 12, legacyStatus: 'APPROVED' }),
    ],
    t,
  );

  it('places the task in the column of its status', () => {
    expect(columnIdOf({ pipelineStatusId: 11, status: 'TODO' }, columns)).toBe('11');
  });

  it('falls back to the enumeration when the status is not offered to the project', () => {
    // An imported task carries the identifier of a status from another project's site: without
    // this fallback, it would simply disappear from the board.
    expect(columnIdOf({ pipelineStatusId: 999, status: 'APPROVED' }, columns)).toBe('12');
  });

  it('returns null when no column can accept it', () => {
    expect(columnIdOf({ pipelineStatusId: null, status: 'RETAKE' }, columns)).toBeNull();
  });
});
