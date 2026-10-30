// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Stable colour derived from a user identifier (14.F). Shared between avatars,
 * real-time presence and the default annotation colour: the same user carries
 * the same hue everywhere.
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

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const c = hex.replace('#', '');
  const channels = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Readable ink on an avatar colour — black or white, whichever contrasts the most.
 *
 * Initials used to be written in white across the whole palette. None of the twelve hues
 * then met the AA threshold of 4.5:1: from 1.98:1 on green to 4.47:1 at best. Black, on the other hand,
 * passes everywhere (4.70:1 at minimum) — but the choice is COMPUTED rather than hard-coded, so
 * that a hue added to the palette tomorrow does not silently reintroduce the problem.
 */
export function readableInk(background: string): '#000000' | '#ffffff' {
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#ffffff') ? '#000000' : '#ffffff';
}
