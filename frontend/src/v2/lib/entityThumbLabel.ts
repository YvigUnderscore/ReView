// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a thumbnail writes when it has no image — the element's name, sized to the space available.
 * Split from `EntityThumb` because a component file may only export components (hot refresh).
 */

/** Font size decreasing with length: a long name must stay readable. */
export function thumbScale(label: string): string {
  if (label.length <= 8) return 'text-xl';
  if (label.length <= 16) return 'text-base';
  if (label.length <= 32) return 'text-sm';
  return 'text-xs';
}

/**
 * Abbreviation for thumbnails too small for a name (compact row: 32 px square).
 *
 * In production the names share their prefix and are told apart by their number (`SH0120`,
 * `SH0130`): it is therefore the last number that identifies, not the initials — "SH" would make
 * them all identical. Failing a digit, the initials of the first two words, like an avatar badge.
 */
export function thumbAbbrev(name: string): string {
  const clean = name.trim();
  if (!clean) return '';
  const numbers = clean.match(/\d+/g);
  // Four digits at most: beyond that, nothing would be legible in 32 px.
  if (numbers) return numbers[numbers.length - 1].slice(-4);
  // Split on nomenclature separators (`_`, `-`, `.`) as well as on spaces.
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  // Iterate by character (not by code unit): a name may start with a character outside the
  // base plane, which a `slice` would cut into two unreadable halves.
  const letters = words.length >= 2 ? [...words[0]][0] + [...words[1]][0] : [...clean].slice(0, 2).join('');
  return letters.toUpperCase();
}
