// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { departmentRank, pickMostAdvanced, groupByDepartment } from './pipelineOrder';
import type { Department } from './projectSettings';

const PIPE: Department[] = [
  { key: 'LAYOUT', name: 'Layout' },
  { key: 'ANIMATION', name: 'Animation' },
  { key: 'FX', name: 'FX' },
  { key: 'LIGHTING', name: 'Lighting' },
  { key: 'COMPOSITING', name: 'Compositing' },
];

const at = (iso: string) => new Date(iso);

describe('departmentRank', () => {
  it('returns the position in the pipeline', () => {
    expect(departmentRank(PIPE, 'LAYOUT')).toBe(0);
    expect(departmentRank(PIPE, 'COMPOSITING')).toBe(4);
  });

  it('ignores case — a DCC writes "anim" where production entered "ANIM"', () => {
    expect(departmentRank(PIPE, 'animation')).toBe(1);
  });

  it('returns -1 for an absent or null department', () => {
    expect(departmentRank(PIPE, 'GRADING')).toBe(-1);
    expect(departmentRank(PIPE, null)).toBe(-1);
    expect(departmentRank(PIPE, undefined)).toBe(-1);
    expect(departmentRank(PIPE, '')).toBe(-1);
  });
});

describe('pickMostAdvanced', () => {
  it('prefers the most downstream step, even if published earlier', () => {
    const winner = pickMostAdvanced(
      [
        { id: 1, department: 'COMPOSITING', at: at('2026-01-01') },
        { id: 2, department: 'ANIMATION', at: at('2026-06-01') },
      ],
      PIPE,
    );
    expect(winner?.id).toBe(1);
  });

  it('breaks a tie between two versions of the same step by the most recent', () => {
    const winner = pickMostAdvanced(
      [
        { id: 1, department: 'FX', at: at('2026-01-01') },
        { id: 2, department: 'FX', at: at('2026-02-01') },
      ],
      PIPE,
    );
    expect(winner?.id).toBe(2);
  });

  it('breaks a tie by identifier at strictly equal date', () => {
    const winner = pickMostAdvanced(
      [
        { id: 7, department: 'FX', at: at('2026-01-01') },
        { id: 9, department: 'FX', at: at('2026-01-01') },
      ],
      PIPE,
    );
    expect(winner?.id).toBe(9);
  });

  it('never lets a department off the pipeline overtake a known step', () => {
    const winner = pickMostAdvanced(
      [
        { id: 1, department: 'LAYOUT', at: at('2026-01-01') },
        { id: 2, department: 'GRADING', at: at('2026-06-01') },
        { id: 3, department: null, at: at('2026-07-01') },
      ],
      PIPE,
    );
    expect(winner?.id).toBe(1);
  });

  it('falls back on the most recent when no candidate is in the pipeline', () => {
    const winner = pickMostAdvanced(
      [
        { id: 1, department: null, at: at('2026-01-01') },
        { id: 2, department: 'GRADING', at: at('2026-06-01') },
      ],
      PIPE,
    );
    expect(winner?.id).toBe(2);
  });

  it('returns null without a candidate', () => {
    expect(pickMostAdvanced([], PIPE)).toBeNull();
  });

  it('stays usable when the project has no department configured', () => {
    const winner = pickMostAdvanced(
      [
        { id: 1, department: 'FX', at: at('2026-01-01') },
        { id: 2, department: 'LIGHTING', at: at('2026-02-01') },
      ],
      [],
    );
    expect(winner?.id).toBe(2);
  });
});

describe('groupByDepartment', () => {
  it('orders the groups according to the pipeline and rejects the unknown ones at the end', () => {
    const groups = groupByDepartment(
      [
        { department: 'COMPOSITING', n: 1 },
        { department: null, n: 2 },
        { department: 'LAYOUT', n: 3 },
        { department: 'GRADING', n: 4 },
      ],
      PIPE,
    );
    expect(groups.map((g) => g.key)).toEqual(['LAYOUT', 'COMPOSITING', null]);
    expect(groups[2]!.items.map((i) => i.n)).toEqual([2, 4]);
  });

  it('keeps the department label and the arrival order within a group', () => {
    const groups = groupByDepartment(
      [
        { department: 'fx', n: 1 },
        { department: 'FX', n: 2 },
      ],
      PIPE,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe('FX');
    expect(groups[0]!.items.map((i) => i.n)).toEqual([1, 2]);
  });

  it('does not invent a group for a declared but empty department', () => {
    const groups = groupByDepartment([{ department: 'FX', n: 1 }], PIPE);
    expect(groups).toHaveLength(1);
  });
});
