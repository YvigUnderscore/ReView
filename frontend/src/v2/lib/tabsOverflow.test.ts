// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { computeVisibleTabs, splitTabs } from './tabsOverflow';

describe('computeVisibleTabs', () => {
  it('shows everything when the bar is wide enough', () => {
    expect(computeVisibleTabs([100, 100, 100], 8, 400, 40)).toBe(3);
  });

  it('takes the gutters into account when deciding that everything fits', () => {
    // 3 × 100 + 2 × 8 = 316: fits at 316, not at 315.
    expect(computeVisibleTabs([100, 100, 100], 8, 316, 40)).toBe(3);
    expect(computeVisibleTabs([100, 100, 100], 8, 315, 40)).toBe(2);
  });

  it('reserves room for the overflow button', () => {
    // budget = 300 - 40 - 8 = 252 → 100 + 8 + 100 = 208 fits, +108 = 316 does not.
    expect(computeVisibleTabs([100, 100, 100, 100], 8, 300, 40)).toBe(2);
  });

  it('returns 0 when even a single tab does not fit with the button', () => {
    expect(computeVisibleTabs([200, 200], 8, 150, 40)).toBe(0);
  });

  it('shows everything while the container is not measured', () => {
    expect(computeVisibleTabs([100, 100], 8, 0, 40)).toBe(2);
  });

  it('handles an empty list', () => {
    expect(computeVisibleTabs([], 8, 500, 40)).toBe(0);
  });
});

describe('splitTabs', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('does not overflow when everything fits', () => {
    expect(splitTabs(items, 5, 0)).toEqual({ visible: items, overflow: [] });
    expect(splitTabs(items, 9, 0).overflow).toEqual([]);
  });

  it('splits in order when the active tab is already visible', () => {
    expect(splitTabs(items, 3, 1)).toEqual({ visible: ['a', 'b', 'c'], overflow: ['d', 'e'] });
  });

  it('moves the active tab to the last visible slot', () => {
    expect(splitTabs(items, 3, 4)).toEqual({ visible: ['a', 'b', 'e'], overflow: ['d', 'c'] });
  });

  it('does not alter the original list', () => {
    const source = [...items];
    splitTabs(source, 2, 4);
    expect(source).toEqual(items);
  });

  it('moves nothing up when no slot is visible', () => {
    expect(splitTabs(items, 0, 3)).toEqual({ visible: [], overflow: items });
  });

  it('ignores an active index out of bounds', () => {
    expect(splitTabs(items, 2, 99)).toEqual({ visible: ['a', 'b'], overflow: ['c', 'd', 'e'] });
  });
});
