// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Measured accessibility of the theme: the guarantees the application gives about its
 * colors and typography, verified on the token file rather than merely promised.
 *
 * Three properties, all stemming from the audit of 2026-08-21:
 *   1. WCAG 1.4.11: the edge of a text input holds 3:1 against the surface around it.
 *      ReView's fields have no contrasted background: this line is their
 *      only boundary, and it held only 1.4:1.
 *   2. A typographic floor: the scale does not go below 11 px, nor below 10 px once the
 *      compact density is applied (it fell to 9.06 px on labels).
 *   3. WCAG 1.4.4: zoom remains possible: the viewport meta tag does not lock it.
 *
 * The ratios are recomputed here rather than living in a comment: changing a token
 * without measuring becomes impossible again.
 */

const css = readFileSync('src/index.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

/** Tokens of a rule block, `--name: value`. */
function tokensOf(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of source.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

/** `:root` (light theme) and `.dark` blocks, in file order. */
function themes(): { light: Record<string, string>; dark: Record<string, string> } {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const [, selector, body] of css.matchAll(/(:root|\.dark)\s*\{([^}]*)\}/g)) {
    Object.assign(selector === '.dark' ? dark : light, tokensOf(body));
  }
  // The dark theme is only an override: whatever it does not redefine comes from `:root`.
  return { light, dark: { ...light, ...dark } };
}

/** `220 25% 97%` → composantes sRGB 0..1. */
export function hslToRgb(value: string): [number, number, number] {
  const [h, s, l] = value.split(/\s+/).map((part) => Number.parseFloat(part));
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** Luminance relative WCAG 2.x. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (x: number) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hslToRgb(a)), luminance(hslToRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Surfaces on which a text input can sit. */
const SURFACES = ['background', 'card', 'popover', 'secondary', 'muted'];

describe('token contrast (WCAG 1.4.11 and 1.4.3)', () => {
  for (const [name, theme] of Object.entries(themes())) {
    it(`theme ${name}: the field border holds 3:1 on all surfaces`, () => {
      for (const surface of SURFACES) {
        expect(contrast(theme.input, theme[surface]), `--input sur --${surface}`).toBeGreaterThanOrEqual(3);
      }
    });

    /**
     * Same rule as `--input`, for the other family of controls: an `outline` button
     * has no flat fill, its border *is* the button. The token did not exist, and the variant
     * borrowed `--border`, a decorative line at 1.37:1 in light and 1.17:1 in dark.
     */
    it(`theme ${name}: the control border holds 3:1 on all surfaces`, () => {
      for (const surface of SURFACES) {
        expect(
          contrast(theme['border-strong'], theme[surface]),
          `--border-strong sur --${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    /**
     * `--border` stays decorative (no WCAG threshold applies to it), but a separator
     * that one cannot see separates nothing. In dark it was exactly `--secondary`, that is
     * 1.00:1: the hairline simply disappeared. The floor is low on purpose:
     * this token is set by default on every element, hardening it would repaint
     * the whole application. What must read as a control takes `--border-strong`.
     */
    it(`theme ${name}: the separator stays perceptible on all surfaces`, () => {
      for (const surface of SURFACES) {
        expect(contrast(theme.border, theme[surface]), `--border sur --${surface}`).toBeGreaterThan(1.25);
      }
    });

    /** The control stroke is distinguished from the decorative one, otherwise the two tokens are one. */
    it(`theme ${name}: the control border clearly dominates the separator`, () => {
      expect(contrast(theme['border-strong'], theme.card)).toBeGreaterThan(
        contrast(theme.border, theme.card) * 2,
      );
    });

    it(`theme ${name}: the text holds 4.5:1, including muted`, () => {
      expect(contrast(theme.foreground, theme.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme['muted-foreground'], theme.background)).toBeGreaterThanOrEqual(4.5);
    });

    /**
     * The guard did not look at the focus ring, nor at the accent, nor the alert color:
     * that is to say, precisely the three tokens that were degrading. Measured on the demo
     * instance: `--ring` fell to 1.93:1 in the light theme as soon as an administrator
     * set their own accent color, making keyboard focus invisible.
     */
    it(`theme ${name}: the focus ring holds 3:1 on all surfaces`, () => {
      for (const surface of SURFACES) {
        expect(contrast(theme.ring, theme[surface]), `--ring sur --${surface}`).toBeGreaterThanOrEqual(3);
      }
    });

    it(`theme ${name}: the accent holds 3:1 on the background, and its ink 4.5:1 on it`, () => {
      expect(contrast(theme.primary, theme.background), '--primary sur --background').toBeGreaterThanOrEqual(
        3,
      );
      expect(
        contrast(theme['primary-foreground'], theme.primary),
        '--primary-foreground sur --primary',
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`theme ${name}: the alert color stays readable`, () => {
      expect(contrast(theme.destructive, theme.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.destructive, theme.card)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('plancher typographique', () => {
  const ramp = Object.entries(themes().light).filter(([name]) => name.startsWith('text-'));
  const rootSize = (selector: string): number => {
    const block = new RegExp(`${selector}\\s*\\{[^}]*font-size:\\s*([\\d.]+)px`).exec(css);
    return Number.parseFloat(block?.[1] ?? '0');
  };

  it('declares the whole ramp in rem', () => {
    expect(ramp.length).toBeGreaterThanOrEqual(5);
    for (const [name, value] of ramp) expect(value, name).toMatch(/rem$/);
  });

  it('does not go below 11 px in normal density, nor below 10 px in compact', () => {
    const smallest = Math.min(...ramp.map(([, value]) => Number.parseFloat(value)));
    expect(smallest * rootSize('html')).toBeGreaterThanOrEqual(11);
    expect(smallest * rootSize("html\\[data-density='compact'\\]")).toBeGreaterThanOrEqual(10);
  });
});

/**
 * The uppercase section label is a deliberate convention, but it cannot
 * *carry* information: `text-transform` produces nothing in zh-Hans, ja and ko, three of
 * the fourteen languages of ReView. The class therefore only declares the case and
 * the letter-spacing; the hierarchy rests on size, weight and color, left to the
 * call site, and so remains readable in a language without case.
 */
describe('section label (.section-label)', () => {
  const block = /\.section-label\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('is declared only once, in the token sheet', () => {
    expect(block).toContain('text-transform: uppercase');
    expect(css.match(/\.section-label\s*\{/g)).toHaveLength(1);
  });

  it('sets neither size, nor weight, nor color: nothing that carries the hierarchy', () => {
    for (const property of ['font-size', 'font-weight', 'color']) {
      expect(block, property).not.toContain(property);
    }
  });

  it('uses the letter-spacing token rather than a hard-coded value', () => {
    expect(block).toContain('letter-spacing: var(--tracking-wide)');
  });
});

describe('zoom (WCAG 1.4.4)', () => {
  it('does not lock the viewport', () => {
    const viewport = /<meta name="viewport" content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
  });
});

/**
 * `color-scheme`: what links the application's theme to everything it embeds.
 *
 * It was declared nowhere. Native controls and scroll bars followed the OS, though above all
 * the **147 documentation figures**: served as `<img src="…svg">`, each carries
 * a `@media (prefers-color-scheme: dark)` variant that resolved against the system.
 * A reader in light theme on a dark OS saw midnight-blue blocks
 * in the middle of a white page, and the reverse in dark theme.
 * `color-scheme` propagates to the embedded image: that is what ties the two together.
 */
describe('color-scheme (propagation to embedded content)', () => {
  // The file first sets `:root` (light theme), then `.dark`. Cutting at this selector
  // separates the two sets of tokens without depending on a brace count.
  const [avantDark, apresDark] = css.split(/\n\s*\.dark\s*\{/);

  it('the light theme declares color-scheme: light', () => {
    expect(avantDark).toContain('color-scheme: light');
  });

  it('the dark theme declares color-scheme: dark', () => {
    expect(apresDark).toBeDefined();
    expect(apresDark?.slice(0, 2000)).toContain('color-scheme: dark');
  });

  it('the documentation figures do carry a dark variant to follow', () => {
    // If this contract disappeared, the declaration above would have no object.
    const figure = readFileSync('../DOCUMENTATION/assets/user-guide/comment-states.svg', 'utf8');
    expect(figure).toContain('@media (prefers-color-scheme: dark)');
  });
});
