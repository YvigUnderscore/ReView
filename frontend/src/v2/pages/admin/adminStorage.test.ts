// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { pctOf, sortedEntries, CATEGORY_LABELS, DERIVED_LABELS } from './adminStorage';

describe('adminStorage — pctOf', () => {
  it('computes a clamped percentage, 0 if the total is zero', () => {
    expect(pctOf(50, 200)).toBe(25);
    expect(pctOf(300, 200)).toBe(100);
    expect(pctOf(10, 0)).toBe(0);
  });
});

describe('adminStorage — sortedEntries', () => {
  it('sorts by descending weight, with labels and percentages', () => {
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
    // Key without a label: nothing to translate, the caller falls back to the raw key.
    expect(entries[2].labelKey).toBeNull();
  });

  it('returns an empty list for an empty aggregate', () => {
    expect(sortedEntries({}, CATEGORY_LABELS, 100)).toEqual([]);
  });
});
