// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { sameSelection, selectionOp } from './selectionHistory';

describe('sameSelection', () => {
  it('compare les splats, pas les objets', () => {
    expect(sameSelection(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(sameSelection(new Set(), new Set())).toBe(true);
    expect(sameSelection(new Set([1, 2]), new Set([1, 3]))).toBe(false);
    expect(sameSelection(new Set([1]), new Set([1, 2]))).toBe(false);
  });
});

describe('selectionOp — un geste de sélection, un cran', () => {
  it('rend la sélection précédente à l’annulation et la nouvelle au rétablissement', () => {
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

  it('ne consomme pas un Ctrl+Z pour rien quand le geste n’a rien changé', () => {
    // Un clic dans le vide, un lasso qui reprend les mêmes splats, un « désélectionner » sur
    // une sélection déjà vide : aucun ne doit s'intercaler entre l'utilisateur et l'édition
    // qu'il voulait vraiment annuler.
    expect(selectionOp('x', new Set([4]), new Set([4]), vi.fn())).toBeNull();
    expect(selectionOp('x', new Set(), new Set(), vi.fn())).toBeNull();
  });
});
