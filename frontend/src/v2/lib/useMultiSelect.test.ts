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

  it('Shift étend la plage depuis l’ancre (2 → 5)', () => {
    const first = computeSelection(new Set(), order, 2, null);
    const range = computeSelection(first.next, order, 5, first.anchor, { shiftKey: true });
    expect([...range.next].sort()).toEqual([2, 3, 4, 5]);
    // L'ancre reste sur le point de départ pendant l'extension.
    expect(range.anchor).toBe(2);
  });

  it('Shift fonctionne à rebours (4 → 1)', () => {
    const first = computeSelection(new Set(), order, 4, null);
    const range = computeSelection(first.next, order, 1, first.anchor, { shiftKey: true });
    expect([...range.next].sort()).toEqual([1, 2, 3, 4]);
  });

  it('Shift sans ancre se comporte comme un simple toggle', () => {
    const r = computeSelection(new Set(), order, 3, null, { shiftKey: true });
    expect([...r.next]).toEqual([3]);
  });

  it('Ctrl/Cmd-clic ajoute sans effacer la sélection existante', () => {
    const s = new Set([1]);
    const r = computeSelection(s, order, 4, 1, { ctrlKey: true });
    expect([...r.next].sort()).toEqual([1, 4]);
  });
});
