// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WidgetHeight, WidgetSettings, WidgetSpan } from '../../lib/widgetLayout';

/**
 * The size model of a composable page — width **and** height, in grid rows.
 *
 * It was born on the project overview (batch 12), written for it. The home page makes exactly
 * the same request, word for word: "I want the same resize settings, of windows, etc." The
 * model therefore moves up a level — it lives with the common frame (`WidgetShell`) and the
 * handle (`WidgetResizeHandle`) that both pages share — instead of being copied a second time.
 *
 * Three decisions hold the behaviour:
 *
 *  1. **The height is a number of rows**, not free pixels. A row is `ROW_HEIGHT`, the gap between
 *     two rows is the grid's (`gap-6`). A layout saved on a 27-inch screen therefore replays
 *     identically on a laptop: only the columns stretch, the rows are the same height everywhere.
 *  2. **The grid packs** (`grid-flow-row-dense`): a block shorter than its neighbour leaves free
 *     rows, and the first following block that fits takes them. This is compaction, obtained
 *     from the browser rather than from a home-made placement algorithm — hence exact to the
 *     pixel, at every screen width.
 *  3. **The content follows the size**: `contentCapacity` says how many items of a given height
 *     fit in a card of N rows. Enlarging a block without giving it more to show would have
 *     changed nothing.
 *
 * This whole file is pure: the geometry can be checked without a screen.
 */

/**
 * Heights offered, in grid rows.
 *
 * A discrete scale, like the widths: the `row-span-*` classes must be written out in full
 * (Tailwind purges what it does not read), and a free pixel height would not survive a change of screen.
 */
export const WIDGET_ROWS = [2, 3, 4, 5, 6] as const;

export type WidgetRows = (typeof WIDGET_ROWS)[number];

/** Height of one row, in pixels (`auto-rows-[5rem]`). */
export const ROW_HEIGHT = 80;

/** Gap between two blocks, in pixels (`gap-6`). */
export const GRID_GAP = 24;

/** Vertical step from one row to the next — row height plus gap. */
export const ROW_PITCH = ROW_HEIGHT + GRID_GAP;

/**
 * Grid classes of a composable page: twelve columns, rows of fixed height, and packing.
 *
 * It replaces the free-height grid (`items-start`, content height) that the home page used to
 * carry: that one aligned blocks to the top, so a short block opened beneath it a gap that its
 * neighbour could not fill.
 */
export const WIDGET_ROW_GRID_CLASS = 'grid grid-cols-12 grid-flow-row-dense auto-rows-[5rem] gap-6';

const ROW_SPAN_CLASS: Record<WidgetRows, string> = {
  2: 'row-span-2',
  3: 'row-span-3',
  4: 'row-span-4',
  5: 'row-span-5',
  6: 'row-span-6',
};

export const rowSpanClass = (rows: WidgetRows): string => ROW_SPAN_CLASS[rows];

/**
 * The old height scale (`short`/`normal`/`tall`) re-read as rows.
 *
 * Layouts saved before the rows carry this key and no height in rows. It is translated **at read
 * time**: preferences are not rewritten, and nobody loses the tall block they had set.
 */
const LEGACY_ROWS: Record<WidgetHeight, WidgetRows> = { short: 2, normal: 3, tall: 5 };

export const isWidgetRows = (value: number): value is WidgetRows =>
  (WIDGET_ROWS as readonly number[]).includes(value);

/**
 * Effective height of a block: the saved one, otherwise the translated old scale, otherwise
 * the registry default. A value off the scale is ignored, not applied wrongly.
 */
export function resolveRows(saved: WidgetSettings | undefined, fallback: WidgetRows): WidgetRows {
  if (saved?.rows !== undefined && isWidgetRows(saved.rows)) return saved.rows;
  if (saved?.height !== undefined) return LEGACY_ROWS[saved.height];
  return fallback;
}

/**
 * Height of a card's frame, in pixels: its inner margins (`p-4`, twice 1 rem) and its header
 * (1.25 rem title plus `mb-3`). This is what does not serve the content.
 */
const CARD_CHROME = 68;

/** Pixels actually available to the content of a card of N rows. */
export const contentHeight = (rows: WidgetRows): number => rows * ROW_PITCH - GRID_GAP - CARD_CHROME;

/**
 * Items of a given height that fit in a card of N rows.
 *
 * This is the only function blocks need to know: a list counts its lines, a thumbnail grid its
 * rows of thumbnails, a hero block its cards. The floor applies to the shortest card, where
 * a few overflowing items are better than an empty block.
 */
export const contentCapacity = (rows: WidgetRows, lineHeight: number, floor = 1): number =>
  Math.max(floor, Math.floor(contentHeight(rows) / lineHeight));

/** Height of a list row (`py-1.5` plus the text, plus the `space-y-1.5` line gap). */
export const LIST_LINE = 30;

/** Rows a list shows in a card of N rows. */
export const listCapacity = (rows: WidgetRows): number => contentCapacity(rows, LIST_LINE, 3);

/**
 * Height of a row of thumbnails: at full width (eight columns), a 16:9 thumbnail is about
 * 87 px, its name 20 px. A row of thumbnails is therefore roughly one grid row — which makes the
 * scale readable: taller, more rows.
 */
export const TILE_LINE = 110;

/** Thumbnail columns according to the block width, and the classes that carry them. */
const TILE_COLUMNS: Record<WidgetSpan, number> = { 3: 2, 4: 3, 6: 4, 8: 6, 12: 8 };

const TILE_GRID_CLASS: Record<WidgetSpan, string> = {
  3: 'grid-cols-2',
  4: 'grid-cols-2 lg:grid-cols-3',
  6: 'grid-cols-2 lg:grid-cols-4',
  8: 'grid-cols-3 lg:grid-cols-6',
  12: 'grid-cols-4 lg:grid-cols-8',
};

export const tileGridClass = (span: WidgetSpan): string => TILE_GRID_CLASS[span];

/** Thumbnails a media grid shows in a block of N rows by N columns. */
export const tileCapacity = (rows: WidgetRows, span: WidgetSpan): number =>
  TILE_COLUMNS[span] * contentCapacity(rows, TILE_LINE);

/** Size of a block: width in columns, height in rows. */
export interface WidgetSize {
  span: WidgetSpan;
  rows: WidgetRows;
}

/** Horizontal and vertical step of the grid, in pixels — gap included. */
export interface GridGeometry {
  column: number;
  row: number;
}

/**
 * Fallback geometry, when the browser renders no layout (test rendering).
 * A 96 px column corresponds to a grid about 1130 px wide, which is the current usable width
 * of the application's content.
 */
export const FALLBACK_GEOMETRY: GridGeometry = { column: 96, row: ROW_PITCH };

/**
 * Step of the grid, read from the container itself.
 *
 * The calculation assumes nothing about the window width: `gridTemplateColumns` gives the tracks
 * actually computed, which makes the gesture accurate at the three responsive breakpoints as well
 * as in a reduced panel.
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
 * `bias` is the direction of the gesture, and it only serves for ties — but they are frequent:
 * the width scale jumps by two (4, 6, 8, 12), so a drag of a single column falls exactly between
 * two steps. Without it, pulling one column to the right from 6 would give 6: the handle would not respond.
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
 * Size aimed at by a drag of the handle: the movement is translated into columns and rows, then
 * the closest offered sizes are kept.
 *
 * The bounding happens here and nowhere else: a block cannot take a width its definition does
 * not offer, nor a height off the scale, whatever the gesture.
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
    rows: nearest(rows, WIDGET_ROWS, delta.dy),
  };
}

/**
 * Next or previous size on one axis — what a keyboard arrow does.
 *
 * The handle is a control, not decoration: the same setting must be reachable without a mouse.
 * At the bounds the size does not change (and the caller therefore saves nothing).
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
  const index = WIDGET_ROWS.indexOf(current.rows);
  const next = WIDGET_ROWS[Math.min(WIDGET_ROWS.length - 1, Math.max(0, index + direction))];
  return { ...current, rows: next ?? current.rows };
}
