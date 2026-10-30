// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { hintClasses } from './hint.variants';

/**
 * The rule the hint carries, and the one that must not be lost: **an explanatory note
 * shrinks, an error or confirmation message never does**. A hint nobody reads has failed
 * its job; an error nobody reads loses the data.
 */
describe('hintClasses', () => {
  it('renders the note in the help step, muted', () => {
    expect(hintClasses()).toBe('text-xs text-muted-foreground');
    expect(hintClasses('muted', 'note')).toBe('text-xs text-muted-foreground');
  });

  it('steps down one level for the panel footnote', () => {
    expect(hintClasses('muted', 'fine')).toBe('text-2xs text-muted-foreground');
  });

  it('NEVER shrinks an error or a confirmation, even if asked to', () => {
    for (const size of ['note', 'fine'] as const) {
      expect(hintClasses('error', size)).toBe('text-sm text-destructive');
      expect(hintClasses('success', size)).toBe('text-sm text-success');
    }
  });

  it('stays on the scale: never a size in pixels', () => {
    for (const tone of ['muted', 'error', 'success'] as const) {
      for (const size of ['note', 'fine'] as const) {
        expect(hintClasses(tone, size)).not.toMatch(/\[\d+px\]/);
      }
    }
  });

  it('does not go below the accessibility floor — `text-2xs` is the last step', () => {
    // `theme.a11y.test.ts` guarantees that `--text-2xs` is 11 px (10 px in compact).
    // A smaller step does not exist: there is nothing to write below it.
    const toutes = (['note', 'fine'] as const).map((size) => hintClasses('muted', size));
    expect(toutes.every((c) => /text-(xs|2xs)\b/.test(c))).toBe(true);
    expect(toutes.some((c) => c.includes('text-3xs'))).toBe(false);
  });
});
