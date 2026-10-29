// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fragmented text search.
 *
 * Testing Library compares the **own** text of an element: the text nodes that are its
 * direct children, end to end. Two sentences separated by a `<br/>` in the same
 * paragraph therefore form a single string, and `getByText('Première phrase.')` fails on
 * a screen that is nonetheless correct. `textIncluding` targets the fragment without going up to ancestors
 * (they have no direct text node containing it), whereas `{ exact: false }`
 * would go up the whole tree and return several matches.
 */
export const textIncluding =
  (fragment: string) =>
  (text: string): boolean =>
    text.includes(fragment);
