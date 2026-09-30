// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { pctOf, sortedEntries, CATEGORY_LABELS, DERIVED_LABELS } from './adminStorage';

describe('adminStorage — pctOf', () => {
  it('calcule un pourcentage borné, 0 si total nul', () => {
    expect(pctOf(50, 200)).toBe(25);
    expect(pctOf(300, 200)).toBe(100);
    expect(pctOf(10, 0)).toBe(0);
  });
});

describe('adminStorage — sortedEntries', () => {
  it('trie par poids décroissant avec libellés et pourcentages', () => {
    const entries = sortedEntries(
      {
        thumbnails: { count: 10, bytes: 100 },
        hls: { count: 3, bytes: 900 },
        inconnu: { count: 1, bytes: 5 },
      },
      DERIVED_LABELS,
      1000,
    );
    expect(entries.map((e) => e.key)).toEqual(['hls', 'thumbnails', 'inconnu']);
    expect(entries[0]).toEqual({
      key: 'hls',
      labelKey: 'storage.d.hls',
      count: 3,
      bytes: 900,
      pct: 90,
    });
    // Clé sans libellé : rien à traduire, l'appelant retombe sur la clé brute.
    expect(entries[2].labelKey).toBeNull();
  });

  it('rend une liste vide pour un agrégat vide', () => {
    expect(sortedEntries({}, CATEGORY_LABELS, 100)).toEqual([]);
  });
});
