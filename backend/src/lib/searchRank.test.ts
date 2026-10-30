// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { bestScore, fieldScore, normalise, rankBy } from './searchRank';

describe('normalise', () => {
  it('ignores case and accents — an artist rarely types accents', () => {
    expect(normalise('Héros')).toBe('heros');
    expect(normalise('SH0120')).toBe('sh0120');
  });
});

describe('fieldScore — match quality', () => {
  it('ranks from the sharpest to the vaguest', () => {
    const exact = fieldScore('SH0120', 'SH0120', 'code')!;
    const prefix = fieldScore('SH0120_v2', 'SH0120', 'code')!;
    const word = fieldScore('ep01 SH0120', 'SH0120', 'code')!;
    const contains = fieldScore('xSH0120', 'SH0120', 'code')!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(contains);
  });

  it('distinguishes the start of a word from a fragment in the middle', () => {
    // "pluie" in "sous la pluie" is worth more than in "parapluie".
    expect(fieldScore('sous la pluie', 'pluie', 'description')!).toBeGreaterThan(
      fieldScore('parapluie', 'pluie', 'description')!,
    );
  });

  it('returns nothing when the value does not match', () => {
    expect(fieldScore('SH0120', 'compositing', 'code')).toBeNull();
    expect(fieldScore(null, 'x', 'code')).toBeNull();
    expect(fieldScore('SH0120', '   ', 'code')).toBeNull();
  });
});

describe('fieldScore — field weight', () => {
  it('prefers a code to a name, and a name to a description', () => {
    // Finding "pluie" in the code of a shot is stronger than in a thirty-line brief, with equal match quality.
    const code = fieldScore('pluie', 'pluie', 'code')!;
    const name = fieldScore('pluie', 'pluie', 'name')!;
    const description = fieldScore('pluie', 'pluie', 'description')!;
    const body = fieldScore('pluie', 'pluie', 'body')!;
    expect(code).toBeGreaterThan(name);
    expect(name).toBeGreaterThan(description);
    expect(description).toBeGreaterThan(body);
  });

  it('an exact match in a description beats a fragment in a code', () => {
    expect(fieldScore('pluie', 'pluie', 'description')!).toBeGreaterThan(
      fieldScore('xpluiex', 'pluie', 'code')!,
    );
  });
});

describe('bestScore', () => {
  it('keeps the best field', () => {
    const score = bestScore('pluie', [
      { value: 'SH0120', field: 'code' },
      { value: 'pluie', field: 'description' },
    ]);
    expect(score).toBe(fieldScore('pluie', 'pluie', 'description'));
  });

  it('returns zero when nothing matches — the result stays, it does not rise', () => {
    expect(bestScore('néant', [{ value: 'SH0120', field: 'code' }])).toBe(0);
  });
});

describe('rankBy', () => {
  it('sorts by descending score', () => {
    const items = [{ s: 1 }, { s: 9 }, { s: 5 }];
    expect(rankBy(items, (i) => i.s).map((i) => i.s)).toEqual([9, 5, 1]);
  });

  it('preserves the original order on equal score — most recent first', () => {
    // The original order comes from the database: between two shots that match equally well, the one that moved recently is the one sought.
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(rankBy(items, () => 5).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('loses no element', () => {
    const items = [{ s: 0 }, { s: 3 }, { s: 0 }];
    expect(rankBy(items, (i) => i.s)).toHaveLength(3);
  });
});
