// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Accessibilité **mesurée** du thème — les garanties que l'application donne sur ses
 * couleurs et sa typographie, vérifiées sur le fichier de tokens plutôt que promises.
 *
 * Trois propriétés, toutes issues de l'audit du 2026-08-21 :
 *   1. WCAG 1.4.11 — la limite d'un contrôle de saisie tient 3:1 avec la surface qui
 *      l'entoure. Les champs de ReView n'ont pas de fond contrasté : ce trait est leur
 *      seule frontière, et il tenait 1,4:1.
 *   2. Un plancher typographique — la rampe ne descend pas sous 11 px, ni sous 10 px une
 *      fois la densité compacte appliquée (elle tombait à 9,06 px sur des libellés).
 *   3. WCAG 1.4.4 — le zoom reste possible : la balise viewport ne le verrouille pas.
 *
 * Les ratios se recalculent ici plutôt que de vivre en commentaire : changer un token
 * sans mesurer redevient impossible.
 */

const css = readFileSync('src/index.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

/** Tokens d'un bloc de règles, `--nom: valeur`. */
function tokensOf(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of source.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

/** Blocs `:root` (thème clair) et `.dark`, dans l'ordre du fichier. */
function themes(): { light: Record<string, string>; dark: Record<string, string> } {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const [, selector, body] of css.matchAll(/(:root|\.dark)\s*\{([^}]*)\}/g)) {
    Object.assign(selector === '.dark' ? dark : light, tokensOf(body));
  }
  // Le thème sombre n'est qu'une surcharge : ce qu'il ne redéfinit pas vient de `:root`.
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

/** Surfaces sur lesquelles un champ de saisie peut se poser. */
const SURFACES = ['background', 'card', 'popover', 'secondary', 'muted'];

describe('contraste des tokens (WCAG 1.4.11 et 1.4.3)', () => {
  for (const [name, theme] of Object.entries(themes())) {
    it(`thème ${name} : la bordure de champ tient 3:1 sur toutes les surfaces`, () => {
      for (const surface of SURFACES) {
        expect(contrast(theme.input, theme[surface]), `--input sur --${surface}`).toBeGreaterThanOrEqual(3);
      }
    });

    it(`thème ${name} : le texte tient 4,5:1, y compris atténué`, () => {
      expect(contrast(theme.foreground, theme.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme['muted-foreground'], theme.background)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('plancher typographique', () => {
  const ramp = Object.entries(themes().light).filter(([name]) => name.startsWith('text-'));
  const rootSize = (selector: string): number => {
    const block = new RegExp(`${selector}\\s*\\{[^}]*font-size:\\s*([\\d.]+)px`).exec(css);
    return Number.parseFloat(block?.[1] ?? '0');
  };

  it('déclare toute la rampe en rem', () => {
    expect(ramp.length).toBeGreaterThanOrEqual(5);
    for (const [name, value] of ramp) expect(value, name).toMatch(/rem$/);
  });

  it('ne descend pas sous 11 px en densité normale, ni sous 10 px en compact', () => {
    const smallest = Math.min(...ramp.map(([, value]) => Number.parseFloat(value)));
    expect(smallest * rootSize('html')).toBeGreaterThanOrEqual(11);
    expect(smallest * rootSize("html\\[data-density='compact'\\]")).toBeGreaterThanOrEqual(10);
  });
});

describe('zoom (WCAG 1.4.4)', () => {
  it('ne verrouille pas le viewport', () => {
    const viewport = /<meta name="viewport" content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
  });
});
