// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  TOOLTIP_DELAY_MS,
  TOOLTIP_SKIP_DELAY_MS,
  shouldRenderTooltip,
  tooltipContentClass,
} from './tooltip.variants';

/** Class order means nothing in CSS: we compare sets. */
const set = (value: string) => new Set(value.split(/\s+/).filter(Boolean));

describe('tooltipContentClass — stacking', () => {
  /*
   * The trap that motivated this test: all the floating layers in the folder are at `z-50`.
   * A tooltip triggered from a modal header is portalled to `body`, like the modal itself;
   * at equal `z-index`, DOM order decides, i.e. the mounting order. One step higher makes
   * the rendering deterministic.
   */
  it('sits above the z-50 layers (dialog, sheet, popover, context menu)', () => {
    const classes = set(tooltipContentClass());
    expect(classes.has('z-[60]')).toBe(true);
    expect(classes.has('z-50')).toBe(false);
  });
});

describe('tooltipContentClass — animation', () => {
  /*
   * Radix Tooltip does not write `open` into its `data-state`: it writes `delayed-open` or
   * `instant-open`. Copying the popover classes (`data-[state=open]:…`) gives a panel that
   * never animates its entry — and the default is invisible on review, hence this lock.
   */
  it('covers both opening states specific to Radix Tooltip', () => {
    const value = tooltipContentClass();
    for (const state of ['delayed-open', 'instant-open']) {
      expect(value, state).toContain(`data-[state=${state}]:animate-in`);
      expect(value, state).toContain(`data-[state=${state}]:fade-in-0`);
    }
  });

  it('does not use the `open` state, which this primitive never produces', () => {
    expect(tooltipContentClass()).not.toContain('data-[state=open]');
  });

  it('also animates the closing', () => {
    const value = tooltipContentClass();
    expect(value).toContain('data-[state=closed]:animate-out');
    expect(value).toContain('data-[state=closed]:fade-out-0');
  });
});

describe('tooltipContentClass — theme', () => {
  /*
   * `check-color-tokens.mjs` already covers the repo, but it reads files: the composition goes
   * through `cn()` and deserves its own safety net, since the primitive is meant to be
   * overridden by its callers.
   */
  it('only paints with theme tokens', () => {
    const classes = [...set(tooltipContentClass())];
    const painted = classes.filter((name) => /^(bg|text|border)-/.test(name));
    expect(painted).toEqual(expect.arrayContaining(['bg-card', 'text-card-foreground', 'border-border']));
    for (const name of painted) {
      // No raw colour from the Tailwind palette, recognisable by its final numeric step.
      // The example is not spelled out: `check-color-tokens` reads this file like the others
      // and would flag the class quoted in the comment.
      expect(name, name).not.toMatch(/-(50|[1-9]00)$/);
    }
  });

  it('does not set any text size in pixels', () => {
    expect(tooltipContentClass()).not.toMatch(/text-\[\d/);
  });
});

describe('tooltipContentClass — override', () => {
  it('lets the caller replace a class rather than stacking it', () => {
    // `cn()` relies on tailwind-merge: the last width wins, it is not added.
    const classes = set(tooltipContentClass('max-w-sm'));
    expect(classes.has('max-w-sm')).toBe(true);
    expect(classes.has('max-w-xs')).toBe(false);
  });

  it('without an override, returns a stable, non-empty string', () => {
    expect(tooltipContentClass()).toBe(tooltipContentClass(undefined));
    expect(tooltipContentClass().length).toBeGreaterThan(0);
  });
});

describe('shouldRenderTooltip', () => {
  /*
   * Callers pass optional labels (shortcut, computed label). Without this filter, an empty
   * string opens an empty bordered panel on hover — a visible defect that is hard to trace back
   * to its cause.
   */
  it('mounts nothing for a missing or empty label', () => {
    for (const label of [undefined, null, false, '', '   ', '\n\t']) {
      expect(shouldRenderTooltip(label), JSON.stringify(label)).toBe(false);
    }
  });

  it('mounts the tooltip as soon as there is something to read', () => {
    for (const label of ['Play', ' Play ', 0, { type: 'span' }]) {
      expect(shouldRenderTooltip(label), JSON.stringify(label)).toBe(true);
    }
  });
});

describe('delays', () => {
  /*
   * The original complaint is quantified: the native tooltip waits ~1.5 s. A setting that
   * approaches it would reproduce the defect being fixed — the test bounds the intent, not
   * the exact value (250 ms), which remains an adjustable product choice.
   */
  const NATIVE_TITLE_DELAY_MS = 1500;

  it('opens clearly faster than the browser native tooltip', () => {
    expect(TOOLTIP_DELAY_MS).toBeLessThan(NATIVE_TITLE_DELAY_MS / 3);
  });

  it('keeps a non-zero delay, so it does not flicker on a passing hover', () => {
    expect(TOOLTIP_DELAY_MS).toBeGreaterThanOrEqual(150);
  });

  it('lets the grace window exceed the delay, otherwise it is useless', () => {
    // Below this, sweeping a dense bar would pay the delay on every icon.
    expect(TOOLTIP_SKIP_DELAY_MS).toBeGreaterThan(TOOLTIP_DELAY_MS);
  });
});
