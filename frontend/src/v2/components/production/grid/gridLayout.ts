// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Grid measurements, in one place.
 *
 * A virtualised table is no longer a table: the header, the head column and the rows are three distinct elements that must
 * fall on the same pixel. These values are therefore numbers set in style, not classes: a `w-24` copied into three files
 * ends up shifting the header by half a character.
 */

/**
 * Width of a column when the status names are short.
 *
 * This is the width from before the name in the cell: a studio whose reference data says "Final" or "Omitted" pays not one
 * pixel more than before.
 */
export const COL_W_MIN = 88;

/**
 * Width cap. Beyond it, twelve columns no longer fit under any reasonable scroll: a longer name is cut and read on hover.
 */
export const COL_W_MAX = 136;

/**
 * What a cell spends outside its name: the separating hairline (1), the button margins (12), the dot (10), the avatar (16),
 * and the two gaps separating them (8).
 */
const CELL_CHROME = 47;

/**
 * Width of a character at `text-2xs` (11 px), in the worst case.
 *
 * A **constant**, and that is the whole point: twelve hundred cells are not measured against the DOM. The approximation can
 * only make a name overflow by a character or two, which `truncate` catches: it never breaks the layout.
 */
const CHAR_W = 6.5;

/**
 * Column width for a status name of `longestName` characters.
 *
 * The grid widens by just what the longest name actually served requires, rather than imposing on everyone the width of the
 * worst imaginable reference data: the default local vocabulary ("In Progress") needs twenty or so pixels more, while a
 * ShotGrid vocabulary ("Final") needs none.
 */
export function columnWidth(longestName: number): number {
  const wanted = CELL_CHROME + longestName * CHAR_W;
  // Quantised to 4 px: the width does not move a hair on each page loaded.
  return Math.min(COL_W_MAX, Math.max(COL_W_MIN, Math.ceil(wanted / 4) * 4));
}

/** Width of the head column: shot code **and** its own status. */
export const HEAD_W = 232;

/** Height of a row, shot or sequence alike: uniform, so nothing to re-measure. */
export const LINE_H = 34;

/** Rows mounted on either side of the window: scrolling shows no gap. */
export const OVERSCAN = 10;

/** Total width of a row for `n` visible columns of `colWidth` pixels. */
export const lineWidth = (columns: number, colWidth: number): number => HEAD_W + columns * colWidth;
