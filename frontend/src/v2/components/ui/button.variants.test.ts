// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { buttonVariants } from './button.variants';

/** Class order means nothing in CSS: we compare sets. */
const set = (value: string) => new Set(value.split(/\s+/).filter(Boolean));

const VARIANTS = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const;

describe('buttonVariants — readability of the variant without a fill', () => {
  /*
   * The original complaint: `outline` put `bg-transparent` on `border-border`, a decorative
   * line at 1.17:1 in dark theme. The button existed without being visible. The fix is not
   * cosmetic: it rests on one specific token, which `theme.a11y.test.ts` separately checks
   * reaches 3:1. This test locks the other half: that the variant consumes that token and
   * not the decorative one.
   */
  it('the outline variant draws its border with the controls token', () => {
    const classes = set(buttonVariants({ variant: 'outline' }));
    expect(classes.has('border-border-strong')).toBe(true);
    expect(classes.has('border-border')).toBe(false);
  });

  it('no other variant takes over the controls token', () => {
    for (const variant of VARIANTS.filter((name) => name !== 'outline')) {
      expect(set(buttonVariants({ variant })).has('border-border-strong'), variant).toBe(false);
    }
  });
});

describe('buttonVariants — pressed state', () => {
  /*
   * The geometric press effect is common to all controls: it is written once in the base
   * of the `cva` (and defined in index.css), never copied per variant.
   */
  it('applies ui-pressable to all variants, without repeating it', () => {
    for (const variant of VARIANTS) {
      const classes = buttonVariants({ variant })
        .split(/\s+/)
        .filter((c) => c === 'ui-pressable');
      expect(classes, variant).toHaveLength(1);
    }
  });

  /*
   * A hover without a pressed state is a click that is not visible: on a slow action,
   * nothing tells "started" apart from "not taken". So every variant that reacts to hover
   * must also react to press.
   */
  it('gives each variant an :active state distinct from its hover', () => {
    for (const variant of VARIANTS) {
      const classes = [...set(buttonVariants({ variant }))];
      const hover = classes.filter((c) => c.startsWith('hover:'));
      const active = classes.filter((c) => c.startsWith('active:'));
      expect(hover.length, `${variant} : survol`).toBeGreaterThan(0);
      expect(active.length, `${variant} : appui`).toBeGreaterThan(0);
      // Pressing does not repeat the hover: it pushes the same property one step further.
      const strip = (prefix: string) => (c: string) => c.slice(prefix.length);
      expect(
        active.map(strip('active:')).some((c) => !hover.map(strip('hover:')).includes(c)),
        `${variant} : l’appui doit différer du survol`,
      ).toBe(true);
    }
  });
});

describe('buttonVariants — shape regression', () => {
  /*
   * The refactoring moves the `cva` into its own module: the output must stay identical,
   * character for character, for the default variant, the most used one.
   */
  it('keeps the default button unchanged', () => {
    expect(set(buttonVariants())).toEqual(
      set(
        'ui-pressable inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium' +
          ' transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none' +
          ' focus-visible:ring-2 focus-visible:ring-ring bg-primary text-primary-foreground' +
          ' hover:bg-primary/90 active:bg-primary/80 px-4 py-2',
      ),
    );
  });

  it('keeps the four sizes', () => {
    expect(set(buttonVariants({ size: 'sm' })).has('text-xs')).toBe(true);
    expect(set(buttonVariants({ size: 'lg' })).has('text-base')).toBe(true);
    expect(set(buttonVariants({ size: 'icon' })).has('h-8')).toBe(true);
    expect(set(buttonVariants({ size: 'default' })).has('px-4')).toBe(true);
  });
});
