// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The engine shared by all settings searches.
 *
 * It used to live in `pages/admin/settingsSearch`, so in administration alone: the settings of a project and those of a
 * profile had no way of being searched, although they ask exactly the same question: "where does one set this". Three
 * families of screens, a single way of searching.
 */

/** Case and accents ignored: "reglages" must find "Réglages". */
export function fold(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * The text in which an entry is searched: its title, its help, and the words one actually uses to designate it. Empty parts
 * are discarded: a card without help must not answer an empty search any more than the others.
 */
export function haystack(parts: readonly (string | undefined)[]): string {
  return fold(parts.filter((part): part is string => Boolean(part)).join(' '));
}

/**
 * Does the entry answer the search? An empty search lets everything through.
 *
 * All the words must be present: "storage quota" must not return half the screen.
 */
export function matchesQuery(hay: string, query: string): boolean {
  const needle = fold(query.trim());
  if (!needle) return true;
  return needle.split(/\s+/).every((word) => hay.includes(word));
}
