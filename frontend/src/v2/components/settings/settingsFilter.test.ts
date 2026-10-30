// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { fold, haystack, matchesQuery } from './settingsFilter';

/**
 * The engine shared by the three families of settings: studio, project, profile. It used to live in administration alone,
 * yet a project and a profile ask the same question: "where does one set this".
 */
describe('fold', () => {
  it('folds accents and case', () => {
    expect(fold('Éléments Masqués')).toBe('elements masques');
  });
});

describe('haystack', () => {
  it('assembles title, help and keywords into a single folded text', () => {
    const hay = haystack(['Burn-ins', 'Template studio', undefined, 'filigrane', 'watermark']);
    expect(hay).toBe('burn-ins template studio filigrane watermark');
  });

  it('discards absent parts rather than leaving holes in it', () => {
    expect(haystack([undefined, 'Avatar', undefined])).toBe('avatar');
  });
});

describe('matchesQuery', () => {
  const hay = haystack(['Burn-ins', 'filigrane', 'watermark', 'slate']);

  it('finds by a word one actually uses, not by the title', () => {
    expect(matchesQuery(hay, 'filigrane')).toBe(true);
    expect(matchesQuery(hay, 'SLATE')).toBe(true);
  });

  it('ignores accents and case', () => {
    expect(matchesQuery(haystack(['Rétention']), 'retention')).toBe(true);
    expect(matchesQuery(haystack(['Retention']), 'RÉTENTION')).toBe(true);
  });

  it('requires all the words: "quota slack" does not return half the screen', () => {
    expect(matchesQuery(hay, 'watermark slate')).toBe(true);
    expect(matchesQuery(hay, 'watermark quota')).toBe(false);
  });

  it('lets everything through when the search is empty', () => {
    expect(matchesQuery(hay, '')).toBe(true);
    expect(matchesQuery(hay, '   ')).toBe(true);
  });

  it('finds nothing for an absent word: the "no settings" message must be able to appear', () => {
    expect(matchesQuery(hay, 'zzzz')).toBe(false);
  });
});
