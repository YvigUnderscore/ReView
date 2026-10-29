// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { cn } from '../../lib/utils';
import { cardVariants } from './card.variants';

/** Class order means nothing in CSS: we compare sets. */
const set = (value: string) => new Set(value.split(/\s+/).filter(Boolean));

describe('cardVariants', () => {
  /*
   * These two cases are the refactoring contract: the primitive must render *exactly* what
   * the panels used to draw by hand. If someone tweaks the scale, these assertions fail
   * before the screen changes.
   */
  it('renders the settings panel identically to the pattern copied across the screens', () => {
    expect(set(cardVariants())).toEqual(
      set('rounded-lg border border-border bg-card text-card-foreground p-4'),
    );
  });

  it('renders the wide panel identically to the p-5 pattern', () => {
    expect(set(cardVariants({ padding: 'lg' }))).toEqual(
      set('rounded-lg border border-border bg-card text-card-foreground p-5'),
    );
  });

  it('renders the clickable tile identically to the navigation pattern', () => {
    expect(set(cn(cardVariants({ interactive: true }), 'block hover:bg-secondary/40'))).toEqual(
      set(
        'block rounded-lg border border-border bg-card text-card-foreground p-4 transition-colors hover:border-primary hover:bg-secondary/40',
      ),
    );
  });

  it('renders the list row identically to the compact pattern', () => {
    expect(set(cardVariants({ variant: 'row' }))).toEqual(
      set('rounded-md border border-border bg-card text-card-foreground px-3 py-2'),
    );
  });

  it('gives the panel a uniform margin and the row a horizontal margin', () => {
    expect(cardVariants({ padding: 'sm' })).toContain('p-3');
    expect(cardVariants({ padding: 'lg' })).toContain('p-5');
    expect(cardVariants({ variant: 'row', padding: 'sm' })).toContain('px-3 py-1.5');
    expect(cardVariants({ variant: 'row', padding: 'lg' })).toContain('px-4 py-3');
  });

  it('adds no margin with padding="none", leaving it to the sub-components', () => {
    for (const variant of ['panel', 'row'] as const) {
      const classes = [...set(cardVariants({ variant, padding: 'none' }))];
      expect(classes.filter((c) => /^p[xy]?-/.test(c))).toEqual([]);
    }
  });

  it('attaches hover only to cards declared clickable', () => {
    expect(cardVariants()).not.toContain('hover:');
    expect(cardVariants({ interactive: true })).toContain('transition-colors hover:border-primary');
  });

  it('only uses theme tokens, never a raw Tailwind colour', () => {
    const every = (['panel', 'row'] as const).flatMap((variant) =>
      (['none', 'sm', 'md', 'lg'] as const).map((padding) =>
        cardVariants({ variant, padding, interactive: true }),
      ),
    );
    // A raw Tailwind colour is recognised by its numeric shade after the hue (background,
    // text or border followed by a hue name then a number); a theme token never has one.
    expect(every.join(' ')).not.toMatch(/\b(?:bg|text|border)-[a-z]+-\d{2,3}\b/);
  });

  it('lets the caller replace the margin with its own', () => {
    // Conversion sites pass their own spacing; twMerge has to decide.
    const classes = set(cn(cardVariants(), 'p-6'));
    expect(classes.has('p-6')).toBe(true);
    expect(classes.has('p-4')).toBe(false);
  });
});
