// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA_CONTRAST, contrastRatio, hslToRgb, mix, type Rgb } from './contrast';

/**
 * Garde-fou de contraste sur le thème lui-même (A2).
 *
 * Les tokens vivent dans index.css, hors de portée de TypeScript : sans ce test, une
 * retouche de palette peut ramener un `--warning` à 2,7:1 sans que rien ne le signale.
 * On lit donc la feuille et on recalcule les ratios réellement rendus à l'écran.
 */

// Vitest s'exécute depuis `frontend/` (cf. vitest.config.ts).
const CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

/** Tokens de statut, tels qu'ils sont posés sur du texte (`text-X`) et sur `bg-X/15`. */
const STATUS_TOKENS = ['primary', 'success', 'warning', 'info', 'destructive', 'accent-2'] as const;

/** Alpha du fond teinté des badges (`components/ui/badge.tsx`). */
const BADGE_ALPHA = 0.15;

function blockOf(selector: string): string {
  const start = CSS.indexOf(selector);
  expect(start, `bloc ${selector} introuvable dans index.css`).toBeGreaterThan(-1);
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

describe.each(THEMES)('tokens de statut — thème $name', ({ block }) => {
  const background = tokenRgb(block, 'background');
  const card = tokenRgb(block, 'card');

  it.each(STATUS_TOKENS)('--%s tient AA sur le fond de page', (token) => {
    expect(contrastRatio(tokenRgb(block, token), background)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it.each(STATUS_TOKENS)('--%s tient AA en badge posé sur une carte', (token) => {
    const color = tokenRgb(block, token);
    // Pire cas : le badge `bg-X/15` posé sur --card, la surface la plus proche de la teinte.
    expect(contrastRatio(color, mix(color, card, BADGE_ALPHA))).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it('le texte principal et le texte atténué tiennent AA', () => {
    expect(contrastRatio(tokenRgb(block, 'foreground'), background)).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(contrastRatio(tokenRgb(block, 'muted-foreground'), background)).toBeGreaterThanOrEqual(
      AA_CONTRAST,
    );
  });

  // Aplats colorés : `bg-X text-X-foreground` (boutons, badges pleins).
  it.each(['primary', 'destructive', 'accent-2', 'secondary', 'card'])(
    'l’aplat --%s reste lisible sous son encre',
    (token) => {
      expect(
        contrastRatio(tokenRgb(block, `${token}-foreground`), tokenRgb(block, token)),
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    },
  );
});
