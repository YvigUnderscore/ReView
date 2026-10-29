// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA_CONTRAST, contrastRatio, hslToRgb, mix, type Rgb } from './contrast';

/**
 * Contrast guard on the theme itself (A2).
 *
 * The tokens live in index.css, out of TypeScript's reach: without this test, a
 * palette tweak can bring a `--warning` down to 2.7:1 without anything flagging it.
 * So we read the stylesheet and recompute the ratios actually rendered on screen.
 */

// Vitest runs from `frontend/` (see vitest.config.ts).
const CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

/** Status tokens, as applied to text (`text-X`) and to `bg-X/15`. */
const STATUS_TOKENS = ['primary', 'success', 'warning', 'info', 'destructive', 'accent-2'] as const;

/** Alpha of the tinted background of badges (`components/ui/badge.tsx`). */
const BADGE_ALPHA = 0.15;

function blockOf(selector: string): string {
  const start = CSS.indexOf(selector);
  expect(start, `block ${selector} not found in index.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', start);
  const end = CSS.indexOf('\n  }', open);
  return CSS.slice(open, end);
}

function tokenRgb(block: string, name: string): Rgb {
  const match = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(block);
  expect(match, `token --${name} introuvable`).not.toBeNull();
  const [, h, s, l] = match!;
  return hslToRgb(Number(h), Number(s), Number(l));
}

const THEMES = [
  { name: 'clair', block: blockOf(':root {') },
  { name: 'sombre', block: blockOf('.dark {') },
];

describe.each(THEMES)('status tokens — theme $name', ({ block }) => {
  const background = tokenRgb(block, 'background');
  const card = tokenRgb(block, 'card');

  it.each(STATUS_TOKENS)('--%s meets AA on the page background', (token) => {
    expect(contrastRatio(tokenRgb(block, token), background)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it.each(STATUS_TOKENS)('--%s meets AA as a badge on a card', (token) => {
    const color = tokenRgb(block, token);
    // Worst case: the `bg-X/15` badge placed on --card, the surface closest to the tint.
    expect(contrastRatio(color, mix(color, card, BADGE_ALPHA))).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it('primary and muted text both meet AA', () => {
    expect(contrastRatio(tokenRgb(block, 'foreground'), background)).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(contrastRatio(tokenRgb(block, 'muted-foreground'), background)).toBeGreaterThanOrEqual(
      AA_CONTRAST,
    );
  });

  // Solid fills: `bg-X text-X-foreground` (buttons, solid badges).
  it.each(['primary', 'destructive', 'accent-2', 'secondary', 'card'])(
    'l’aplat --%s reste lisible sous son encre',
    (token) => {
      expect(
        contrastRatio(tokenRgb(block, `${token}-foreground`), tokenRgb(block, token)),
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    },
  );
});
