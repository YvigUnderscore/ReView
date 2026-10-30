// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { VIRTUALIZE_FROM, activeIndexIn, shouldVirtualize, withActiveIndex } from './kanbanVirtual';

/**
 * The decisions of the dense column, outside the DOM.
 *
 * On a feature film a column holds hundreds of cards: what gets mounted and what stays mounted
 * during a drag depends on these three functions.
 */
describe('shouldVirtualize', () => {
  it('lets a small column mount in full', () => {
    expect(shouldVirtualize(0)).toBe(false);
    expect(shouldVirtualize(VIRTUALIZE_FROM)).toBe(false);
  });

  it('virtualizes as soon as the column exceeds the threshold', () => {
    expect(shouldVirtualize(VIRTUALIZE_FROM + 1)).toBe(true);
    expect(shouldVirtualize(2000)).toBe(true);
  });
});

describe('activeIndexIn', () => {
  const tasks = [{ id: 7 }, { id: 8 }, { id: 9 }];

  it('finds the dragged card when it belongs to the column', () => {
    expect(activeIndexIn(tasks, 9)).toBe(2);
  });

  it('returns -1 when no drag is in progress or for a card from another column', () => {
    expect(activeIndexIn(tasks, null)).toBe(-1);
    expect(activeIndexIn(tasks, 42)).toBe(-1);
  });
});

describe('withActiveIndex', () => {
  it('touches nothing when no drag is in progress', () => {
    expect(withActiveIndex([3, 4, 5], -1)).toEqual([3, 4, 5]);
  });

  it('does not duplicate a card already in the window', () => {
    expect(withActiveIndex([3, 4, 5], 4)).toEqual([3, 4, 5]);
  });

  it('adds back the dragged card that left the window, keeping ascending order', () => {
    // The virtualizer assumes a sorted window: an index appended at the tail would place the card
    // at the wrong offset, and the preview followed by the cursor would lose its reference.
    expect(withActiveIndex([10, 11, 12], 2)).toEqual([2, 10, 11, 12]);
    expect(withActiveIndex([10, 11, 12], 900)).toEqual([10, 11, 12, 900]);
  });

  it('does not modify the window it receives', () => {
    const range = [10, 11];
    withActiveIndex(range, 2);
    expect(range).toEqual([10, 11]);
  });
});
