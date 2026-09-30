// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Couleur stable dérivée d'un identifiant utilisateur (14.F). Partagée entre les avatars,
 * la présence temps réel et la couleur d'annotation par défaut : un même utilisateur porte
 * partout la même teinte.
 */
export const USER_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
] as const;

export function userColor(seed: number | string): string {
  const n = typeof seed === 'number' ? seed : [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  return USER_COLORS[n % USER_COLORS.length];
}

/** Luminance relative WCAG d'une couleur `#rrggbb`. */
function luminance(hex: string): number {
  const c = hex.replace('#', '');
  const channels = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Rapport de contraste entre deux couleurs `#rrggbb`. */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Encre lisible sur une couleur d'avatar — noire ou blanche, celle qui contraste le plus.
 *
 * Les initiales étaient écrites en blanc sur toute la palette. Aucune des douze teintes ne
 * tenait alors le seuil AA de 4,5:1 : de 1,98:1 sur le vert à 4,47:1 au mieux. Le noir, lui,
 * passe partout (4,70:1 au minimum) — mais le choix se CALCULE plutôt que de se figer, pour
 * qu'une teinte ajoutée demain à la palette ne réintroduise pas le problème en silence.
 */
export function readableInk(background: string): '#000000' | '#ffffff' {
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#ffffff') ? '#000000' : '#ffffff';
}
