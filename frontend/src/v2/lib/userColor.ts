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
  return USER_COLORS[n % USER_COLORS.length]!;
}
