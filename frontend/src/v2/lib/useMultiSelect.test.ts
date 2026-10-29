// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { computeSelection } from './useMultiSelect';

const order = [1, 2, 3, 4, 5];

describe('computeSelection', () => {
  it('bascule un id (ajout puis retrait)', () => {
    const a = computeSelection(new Set(), order, 3, null);
    expect([...a.next]).toEqual([3]);
    expect(a.anchor).toBe(3);
    const b = computeSelection(a.next, order, 3, a.anchor);
    expect([...b.next]).toEqual([]);
  });

  it('Shift extends the range from the anchor (2 → 5)', () => {
    const first = computeSelection(new Set(), order, 2, null);
    const range = computeSelection(first.next, order, 5, first.anchor, { shiftKey: true });
    expect([...range.next].sort()).toEqual([2, 3, 4, 5]);
    // The anchor stays on the starting point during the extension.
    expect(range.anchor).toBe(2);
  });

  it('Shift works backwards (4 → 1)', () => {
    const first = computeSelection(new Set(), order, 4, null);
    const range = computeSelection(first.next, order, 1, first.anchor, { shiftKey: true });
    expect([...range.next].sort()).toEqual([1, 2, 3, 4]);
  });

  it('Shift without an anchor behaves like a simple toggle', () => {
    const r = computeSelection(new Set(), order, 3, null, { shiftKey: true });
    expect([...r.next]).toEqual([3]);
  });

  it('Ctrl/Cmd-click adds without clearing the existing selection', () => {
    const s = new Set([1]);
    const r = computeSelection(s, order, 4, 1, { ctrlKey: true });
    expect([...r.next].sort()).toEqual([1, 4]);
  });
});
