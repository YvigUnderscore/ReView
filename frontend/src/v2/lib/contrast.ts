// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Contraste et normalisation des couleurs de données (A2).
 *
 * Un statut peut porter une couleur venue de la base : celle du site ShotGrid, ou celle
 * qu'un admin a choisie. Elle est pensée pour l'outil d'origine, pas pour le thème bleu
 * nuit de ReView — un bleu marine y devient illisible, un jaune pâle l'est en thème clair.
 * On garde donc la teinte (elle porte le sens) et on corrige la seule luminosité.
 *
 * Tout est en RVB normalisé 0..1 et suit la formule de luminance relative WCAG 2.1.
 */

export type Rgb = [number, number, number];

/** Rapport de contraste minimal WCAG AA pour du texte de taille normale. */
export const AA_CONTRAST = 4.5;

/** Surfaces de référence des deux thèmes (cf. `--card` et `--background` d'index.css). */
const DARK_SURFACE: Rgb = hslToRgb(223, 28, 10);
const LIGHT_SURFACE: Rgb = hslToRgb(220, 25, 97);

/** Opacité du fond teinté d'un badge de statut. */
const BADGE_ALPHA = 0.15;

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = h / 360;
  const sat = s / 100;
  const lig = l / 100;
  const channel = (n: number) => {
    const k = (n + hue * 12) % 12;
    const a = sat * Math.min(lig, 1 - lig);
    return lig - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [channel(0), channel(8), channel(4)];
}

export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

/** `#rgb` ou `#rrggbb`, avec ou sans dièse. `null` si la chaîne n'est pas une couleur. */
export function hexToRgb(hex: string): Rgb | null {
  const raw = hex.trim().replace(/^#/, '');
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = Number.parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Composition d'une couleur semi-transparente sur un fond opaque. */
export function mix(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)) as Rgb;
}

/**
 * Remonte (thème sombre) ou descend (thème clair) la luminosité jusqu'à atteindre le seuil
 * AA face au fond donné. Teinte et saturation sont conservées. Renvoie la luminosité
 * extrême si le seuil reste hors d'atteinte — mieux vaut le plus lisible possible.
 */
export function readableLightness(
  hue: number,
  saturation: number,
  lightness: number,
  background: Rgb,
  isDark: boolean,
): number {
  const step = isDark ? 1 : -1;
  const start = Math.round(lightness);
  for (let i = 0; i <= 100; i += 1) {
    const candidate = start + step * i;
    if (candidate < 0 || candidate > 100) break;
    if (contrastRatio(hslToRgb(hue, saturation, candidate), background) >= AA_CONTRAST) {
      return candidate;
    }
  }
  return isDark ? 100 : 0;
}

export interface StatusSwatch {
  backgroundColor: string;
  color: string;
  borderColor: string;
}

/**
 * Jeton coloré lisible pour une couleur de statut venue des données.
 *
 * Le fond garde la teinte d'origine (le statut reste reconnaissable d'un coup d'œil) ;
 * seul le texte est corrigé pour tenir 4,5:1 dessus. `null` en entrée — statut sans
 * couleur — renvoie `null`, l'appelant retombe alors sur les tokens du thème.
 */
export function statusSwatch(hex: string | null | undefined, isDark: boolean): StatusSwatch | null {
  if (!hex) return null;
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  // Arrondi d'abord : la couleur émise est en entiers, c'est donc sur elle que le calcul
  // de lisibilité doit porter. Sinon le rendu réel manque le seuil de quelques centièmes.
  const [rawH, rawS, rawL] = rgbToHsl(rgb);
  const h = Math.round(rawH);
  const s = Math.round(rawS);
  const l = Math.round(rawL);
  const surface = isDark ? DARK_SURFACE : LIGHT_SURFACE;
  const composed = mix(hslToRgb(h, s, l), surface, BADGE_ALPHA);
  const readable = readableLightness(h, s, l, composed, isDark);
  return {
    backgroundColor: `hsl(${h} ${s}% ${l}% / ${BADGE_ALPHA})`,
    color: `hsl(${h} ${s}% ${readable}%)`,
    borderColor: `hsl(${h} ${s}% ${l}% / 0.4)`,
  };
}
