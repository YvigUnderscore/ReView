// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { sameSelection, selectionOp } from './selectionHistory';

describe('sameSelection', () => {
  it('compares splats, not objects', () => {
    expect(sameSelection(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(sameSelection(new Set(), new Set())).toBe(true);
    expect(sameSelection(new Set([1, 2]), new Set([1, 3]))).toBe(false);
    expect(sameSelection(new Set([1]), new Set([1, 2]))).toBe(false);
  });
});

describe('selectionOp — one selection gesture, one step', () => {
  it('restores the previous selection on undo and the new one on redo', () => {
    const apply = vi.fn();
    const before = new Set([1, 2]);
    const after = new Set([3]);
    const op = selectionOp('Splat selection', before, after, apply);

    expect(op).not.toBeNull();
    op!.undo();
    expect(apply).toHaveBeenLastCalledWith(before);
    op!.redo();
    expect(apply).toHaveBeenLastCalledWith(after);
  });

  it('does not consume a Ctrl+Z for nothing when the gesture changed nothing', () => {
    // A click in the void, a lasso re-selecting the same splats, a "deselect" on an already
    // empty selection: none of them should come between the user and the edit they really
    // wanted to undo.
    expect(selectionOp('x', new Set([4]), new Set([4]), vi.fn())).toBeNull();
    expect(selectionOp('x', new Set(), new Set(), vi.fn())).toBeNull();
  });
});
