// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Filtering of the palette's fixed entries (destinations and actions).
 *
 * `Command` is mounted with `shouldFilter={false}`: the entity results come from the server, already ranked, so cmdk sorts
 * nothing by itself. Without this filter, the fixed entries all stayed displayed while typing; with the old `!hasQuery`, they
 * all disappeared. Neither of the two lets one type "kanb" to go to the kanban.
 *
 * In its own module: a file exporting both a component and functions breaks Vite's hot reload.
 */

/** Tolerant comparison: case and accents ignored, so "reglages" must find "Réglages". */
export function foldForSearch(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/** Entries whose label, or technical key (stable from one language to another), contains the input. */
export function matchDestinations<T extends { label: string; key: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const needle = foldForSearch(query.trim());
  if (!needle) return [...items];
  return items.filter((item) => foldForSearch(item.label).includes(needle) || item.key.includes(needle));
}
