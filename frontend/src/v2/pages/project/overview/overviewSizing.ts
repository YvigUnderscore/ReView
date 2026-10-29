// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WidgetHeight, WidgetSettings, WidgetSpan } from '@/v2/lib/widgetLayout';

/**
 * The size model of the overview: width **and** height, in grid rows.
 *
 * A block used to carry only a width. Its height was that of its content, and the grid aligned the
 * blocks to the top: a short block left beneath it a hole that its neighbour could not fill, and an
 * enlarged card in width always showed three lines. That is exactly what the user circled in red:
 * wide empty areas beneath the published media and beside the two task lists.
 *
 * Three decisions hold the answer:
 *
 *  1. **The height is a number of rows**, not free pixels. A row is worth `ROW_HEIGHT`, and the gap
 *     between two rows is that of the grid (`gap-6`). A layout saved on a 27-inch screen therefore
 *     replays identically on a laptop: only the columns stretch, the rows have the same height
 *     everywhere.
 *  2. **The grid packs** (`grid-flow-row-dense`): a block shorter than its neighbour leaves free
 *     rows, and the first following block that fits takes them. This is packing obtained from the
 *     browser rather than from a home-made placement algorithm, so it is exact to the pixel at every
 *     screen width.
 *  3. **The content follows the size**: `listCapacity` and `tileCapacity` say how many lines or
 *     thumbnails fit in a card of N rows. Enlarging a block without giving it more to show would
 *     have fixed nothing.
 *
 * This whole file is pure: the geometry is verified without a screen.
 */

/**
 * Heights offered, in grid rows.
 *
 * A discrete scale, like the widths: the `row-span-*` classes must be written out in full (Tailwind
 * purges what it does not read), and a free height in pixels would not survive a change of screen.
 */
export const OVERVIEW_ROWS = [2, 3, 4, 5, 6] as const;

export type OverviewRows = (typeof OVERVIEW_ROWS)[number];

/** Height of a row, in pixels (`auto-rows-[5rem]`). */
export const ROW_HEIGHT = 80;

/** Gap between two blocks, in pixels (`gap-6`). */
export const GRID_GAP = 24;

/** Vertical step from one row to the next: row height plus gap. */
export const ROW_PITCH = ROW_HEIGHT + GRID_GAP;

/**
 * Classes of the overview grid.
 *
 * It cannot be that of the other composable pages (`WIDGET_GRID_CLASS`): this one has rows of
 * fixed height, packs its blocks, and lets them stretch over the height of their footprint. The
 * home page, by contrast, still aligns its blocks to the top (`items-start`) and lets them take the
 * height of their content.
 */
export const OVERVIEW_GRID_CLASS = 'grid grid-cols-12 grid-flow-row-dense auto-rows-[5rem] gap-6';

const ROW_SPAN_CLASS: Record<OverviewRows, string> = {
  2: 'row-span-2',
  3: 'row-span-3',
  4: 'row-span-4',
  5: 'row-span-5',
  6: 'row-span-6',
};

export const rowSpanClass = (rows: OverviewRows): string => ROW_SPAN_CLASS[rows];

/**
 * The former height scale (`short`/`normal`/`tall`) read back as rows.
 *
 * Layouts saved before this batch carry that key and no height in rows. It is translated **on
 * read**: the preferences are not rewritten, and nobody loses the tall block they had set.
 */
const LEGACY_ROWS: Record<WidgetHeight, OverviewRows> = { short: 2, normal: 3, tall: 5 };

export const isOverviewRows = (value: number): value is OverviewRows =>
  (OVERVIEW_ROWS as readonly number[]).includes(value);

/**
 * Effective height of a block: the saved one, otherwise the former scale translated, otherwise the
 * registry default. A value outside the scale is ignored, not applied wrongly.
 */
export function resolveRows(saved: WidgetSettings | undefined, fallback: OverviewRows): OverviewRows {
  if (saved?.rows !== undefined && isOverviewRows(saved.rows)) return saved.rows;
  if (saved?.height !== undefined) return LEGACY_ROWS[saved.height];
  return fallback;
}

/**
 * Height of a card's frame, in pixels: its inner margins (`p-4`, twice 1 rem) and its header (a
 * 1.25 rem title plus `mb-3`). This is what does not serve the content.
 */
const CARD_CHROME = 68;

/** Pixels actually available to the content of a card of N rows. */
const contentHeight = (rows: OverviewRows): number => rows * ROW_PITCH - GRID_GAP - CARD_CHROME;

/** Height of a list line (`py-1.5` plus the text, plus the `space-y-1.5` spacing). */
const LIST_LINE = 30;

/**
 * Lines a list shows in a card of N rows. The floor of three applies to the shortest card, where
 * three overflowing lines are better than an empty list.
 */
export const listCapacity = (rows: OverviewRows): number =>
  Math.max(3, Math.floor(contentHeight(rows) / LIST_LINE));

/**
 * Height of a row of thumbnails: at full width (eight columns), a 16:9 thumbnail is about 87 px and
 * its name 20 px. A row of thumbnails is therefore roughly one grid row, which makes the scale
 * readable: taller means more rows.
 */
const TILE_LINE = 110;

/** Thumbnail columns according to the block's width, and the classes that carry them. */
const TILE_COLUMNS: Record<WidgetSpan, number> = { 3: 2, 4: 3, 6: 4, 8: 6, 12: 8 };

const TILE_GRID_CLASS: Record<WidgetSpan, string> = {
  3: 'grid-cols-2',
  4: 'grid-cols-2 lg:grid-cols-3',
  6: 'grid-cols-2 lg:grid-cols-4',
  8: 'grid-cols-3 lg:grid-cols-6',
  12: 'grid-cols-4 lg:grid-cols-8',
};

export const tileGridClass = (span: WidgetSpan): string => TILE_GRID_CLASS[span];

/** Thumbnails a media grid shows in a block of N rows over N columns. */
export const tileCapacity = (rows: OverviewRows, span: WidgetSpan): number =>
  TILE_COLUMNS[span] * Math.max(1, Math.floor(contentHeight(rows) / TILE_LINE));

/** Size of a block: width in columns, height in rows. */
export interface WidgetSize {
  span: WidgetSpan;
  rows: OverviewRows;
}

/** Horizontal and vertical step of the grid, in pixels, gap included. */
export interface GridGeometry {
  column: number;
  row: number;
}

/**
 * Fallback geometry, when the browser renders no layout (test rendering).
 * A 96 px column corresponds to a grid about 1,130 px wide, which is the current useful width of
 * the application's content.
 */
export const FALLBACK_GEOMETRY: GridGeometry = { column: 96, row: ROW_PITCH };

/**
 * Step of the grid, read from the container itself.
 *
 * The computation assumes nothing about the window width: `gridTemplateColumns` gives the tracks
 * actually computed, which makes the gesture exact at the three responsive breakpoints as well as
 * in a reduced panel.
 */
export function gridGeometry(container: Element | null): GridGeometry {
  if (!container || typeof getComputedStyle !== 'function') return FALLBACK_GEOMETRY;
  const style = getComputedStyle(container);
  const gap = Number.parseFloat(style.rowGap);
  const spacing = Number.isFinite(gap) ? gap : GRID_GAP;
  const track = Number.parseFloat(style.gridTemplateColumns.split(' ')[0] ?? '');
  const row = Number.parseFloat(style.gridAutoRows);
  return {
    column: Number.isFinite(track) && track > 0 ? track + spacing : FALLBACK_GEOMETRY.column,
    row: Number.isFinite(row) && row > 0 ? row + spacing : FALLBACK_GEOMETRY.row,
  };
}

/**
 * The offered value closest to the one aimed at.
 *
 * `bias` is the direction of the gesture, and it only serves for ties, but ties are frequent: the
 * width scale jumps by two (4, 6, 8, 12), so a drag of a single column lands exactly between two
 * notches. Without it, dragging one column to the right from 6 would return 6, and the handle would
 * not respond.
 */
function nearest<T extends number>(wanted: number, offered: readonly T[], bias: number): T {
  const sorted = [...offered].sort((a, b) => a - b);
  let best = sorted[0];
  for (const value of sorted) {
    const distance = Math.abs(value - wanted);
    const kept = Math.abs(best - wanted);
    if (distance < kept || (distance === kept && bias > 0)) best = value;
  }
  return best;
}

/**
 * Size targeted by a drag of the handle: the movement is translated into columns and rows, then the
 * offered sizes closest to it are retained.
 *
 * The bounding happens here and nowhere else: a block cannot take a width its definition does not
 * offer, nor a height outside the scale, whatever the gesture.
 */
export function resizeTarget(
  start: WidgetSize,
  delta: { dx: number; dy: number },
  geometry: GridGeometry,
  spans: WidgetSpan[],
): WidgetSize {
  const columns = start.span + Math.round(delta.dx / geometry.column);
  const rows = start.rows + Math.round(delta.dy / geometry.row);
  return {
    span: nearest(columns, spans, delta.dx),
    rows: nearest(rows, OVERVIEW_ROWS, delta.dy),
  };
}

/**
 * Next or previous size on an axis: what an arrow key of the keyboard does.
 *
 * The handle is a control, not decoration: the same setting must be reachable without a mouse. At
 * the bounds the size does not change, and the caller therefore saves nothing.
 */
export function stepSize(
  current: WidgetSize,
  axis: 'span' | 'rows',
  direction: -1 | 1,
  spans: WidgetSpan[],
): WidgetSize {
  if (axis === 'span') {
    const sorted = [...spans].sort((a, b) => a - b);
    const index = sorted.indexOf(current.span);
    return {
      ...current,
      span: sorted[Math.min(sorted.length - 1, Math.max(0, index + direction))] ?? current.span,
    };
  }
  const index = OVERVIEW_ROWS.indexOf(current.rows);
  const next = OVERVIEW_ROWS[Math.min(OVERVIEW_ROWS.length - 1, Math.max(0, index + direction))];
  return { ...current, rows: next ?? current.rows };
}
