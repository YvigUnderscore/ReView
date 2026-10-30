// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { findRawColorClasses } from './check-color-tokens.mjs';

const matches = (source) => findRawColorClasses(source).map((o) => o.match);

describe('findRawColorClasses — palette brute', () => {
  it('reports a palette shade', () => {
    expect(matches('<div className="bg-blue-500" />')).toEqual(['bg-blue-500']);
  });

  it('reports every colour-carrying prefix', () => {
    expect(matches('"text-amber-400 border-rose-200 fill-emerald-600"')).toEqual([
      'text-amber-400',
      'border-rose-200',
      'fill-emerald-600',
    ]);
  });

  it('reports the opacity variant along with it', () => {
    expect(matches('"border-rose-200/50"')).toEqual(['border-rose-200/50']);
  });

  it('reports the class behind a state variant', () => {
    expect(matches('"hover:ring-emerald-600 dark:bg-red-950"')).toEqual(['ring-emerald-600', 'bg-red-950']);
  });

  it('returns the line, the column and the kind of each occurrence', () => {
    const [occ] = findRawColorClasses('const a = 1;\nconst b = "text-sky-300";');
    expect(occ).toEqual({ line: 2, column: 12, match: 'text-sky-300', kind: 'palette' });
  });
});

describe('findRawColorClasses — arbitrary colours', () => {
  it('reports a hexadecimal value', () => {
    expect(matches('"bg-[#ff0000]"')).toEqual(['bg-[#ff0000]']);
  });

  it('reports rgb, hsl and oklch', () => {
    expect(matches('"text-[rgb(1,2,3)] fill-[hsl(200,50%,50%)] stroke-[oklch(0.7_0.1_200)]"')).toEqual([
      'text-[rgb(1,2,3)]',
      'fill-[hsl(200,50%,50%)]',
      'stroke-[oklch(0.7_0.1_200)]',
    ]);
  });
});

describe('findRawColorClasses — what remains allowed', () => {
  it('lets theme tokens through', () => {
    expect(matches('"bg-primary text-muted-foreground bg-destructive/20 bg-warning"')).toEqual([]);
  });

  it('lets neutrals outside the palette through', () => {
    expect(matches('"bg-white/50 text-black bg-transparent fill-current text-inherit"')).toEqual([]);
  });

  it('lets non-colour arbitrary values through', () => {
    expect(
      matches('"text-[10px] bg-[image:var(--x)] bg-[var(--panel)] shadow-[0_1px_0_var(--border)]"'),
    ).toEqual([]);
  });
});

describe('findRawColorClasses — false friends', () => {
  it('ignores a palette name used as a prefix', () => {
    expect(matches('"sky-blue-500"')).toEqual([]);
  });

  it('ignores a prefix buried in a word', () => {
    expect(matches('"subtext-blue-500 x-bg-red-500"')).toEqual([]);
  });

  it('ignores a number that is not a shade', () => {
    expect(matches('"bg-red-5"')).toEqual([]);
  });

  // Accepted limit of the textual check: the exact pattern is reported wherever it appears,
  // including in a comment — it has no reason to exist outside a class.
  it('reports the pattern even outside a className', () => {
    expect(matches('// ne pas réintroduire bg-blue-500 ici')).toEqual(['bg-blue-500']);
  });
});
