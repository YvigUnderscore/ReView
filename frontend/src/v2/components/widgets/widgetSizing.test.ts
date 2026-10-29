// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  FALLBACK_GEOMETRY,
  WIDGET_ROWS,
  WIDGET_ROW_GRID_CLASS,
  contentCapacity,
  listCapacity,
  resizeTarget,
  resolveRows,
  rowSpanClass,
  stepSize,
  tileCapacity,
  type WidgetSize,
} from './widgetSizing';
import type { WidgetSpan } from '../../lib/widgetLayout';

/**
 * The size model shared by the composable pages — the geometry of the gesture, the re-reading
 * of old layouts, and what the size offers the content.
 *
 * It is mounted here from the overview so that the home page receives it as-is, rather than
 * a second copy that would have to be corrected twice. What these cases lock is precisely what
 * must stay true on both sides: a gesture never produces a footprint the grid cannot render, a
 * preference saved before the rows is re-read without being rewritten, and a bigger card really
 * shows more.
 */

const SPANS: WidgetSpan[] = [4, 6, 8, 12];
const start: WidgetSize = { span: 6, rows: 3 };

const drag = (dx: number, dy: number, spans: WidgetSpan[] = SPANS) =>
  resizeTarget(start, { dx, dy }, FALLBACK_GEOMETRY, spans);

describe('resizeTarget — the handle gesture', () => {
  it('translates the drag into columns and rows', () => {
    expect(drag(FALLBACK_GEOMETRY.column, 0)).toEqual({ span: 8, rows: 3 });
    expect(drag(0, FALLBACK_GEOMETRY.row)).toEqual({ span: 6, rows: 4 });
    // A single gesture sets both axes: that is the whole requirement.
    expect(drag(2 * FALLBACK_GEOMETRY.column, 2 * FALLBACK_GEOMETRY.row)).toEqual({ span: 8, rows: 5 });
  });

  it('does not move until the gesture has crossed half a step', () => {
    expect(drag(FALLBACK_GEOMETRY.column / 3, FALLBACK_GEOMETRY.row / 3)).toEqual(start);
  });

  it('clamps to the offered sizes, however far one pulls', () => {
    expect(drag(5000, 5000)).toEqual({ span: 12, rows: 6 });
    expect(drag(-5000, -5000)).toEqual({ span: 4, rows: 2 });
  });

  it('ignores the widths the block does not offer', () => {
    expect(drag(-5000, 0, [6, 8, 12]).span).toBe(6);
  });
});

describe('stepSize — the same setting by keyboard', () => {
  it('advances one step on the requested axis', () => {
    expect(stepSize(start, 'span', 1, SPANS)).toEqual({ span: 8, rows: 3 });
    expect(stepSize(start, 'span', -1, SPANS)).toEqual({ span: 4, rows: 3 });
    expect(stepSize(start, 'rows', 1, SPANS)).toEqual({ span: 6, rows: 4 });
    expect(stepSize(start, 'rows', -1, SPANS)).toEqual({ span: 6, rows: 2 });
  });

  it('does not go beyond the scale at its bounds', () => {
    expect(stepSize({ span: 12, rows: 6 }, 'rows', 1, SPANS)).toEqual({ span: 12, rows: 6 });
    expect(stepSize({ span: 4, rows: 2 }, 'span', -1, SPANS)).toEqual({ span: 4, rows: 2 });
  });
});

describe('resolveRows', () => {
  it('takes the saved height', () => {
    expect(resolveRows({ rows: 5 }, 3)).toBe(5);
  });

  it('re-reads the old scale of a layout saved before the rows', () => {
    // The aim is not to convert preferences — they are not rewritten — but not to lose
    // the tall block someone had set.
    expect(resolveRows({ height: 'tall' }, 3)).toBe(5);
    expect(resolveRows({ height: 'short' }, 4)).toBe(2);
    expect(resolveRows({ height: 'normal' }, 6)).toBe(3);
  });

  it('treats a missing height as the block default', () => {
    expect(resolveRows(undefined, 4)).toBe(4);
    expect(resolveRows({ span: 12 }, 2)).toBe(2);
  });

  it('ignores a height off the scale rather than applying it wrongly', () => {
    expect(resolveRows({ rows: 9 }, 3)).toBe(3);
    expect(resolveRows({ rows: 0 }, 3)).toBe(3);
  });

  it('prefers the rows over the old scale when both are present', () => {
    expect(resolveRows({ rows: 6, height: 'short' }, 3)).toBe(6);
  });
});

describe('the content follows the size', () => {
  it('shows more lines in a taller card', () => {
    const lines = WIDGET_ROWS.map((rows) => listCapacity(rows));
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(new Set(lines).size).toBe(lines.length);
    expect(listCapacity(6)).toBeGreaterThan(2 * listCapacity(2));
  });

  it('shows more thumbnails in a card that is taller or wider', () => {
    expect(tileCapacity(6, 12)).toBeGreaterThan(tileCapacity(2, 12));
    expect(tileCapacity(4, 12)).toBeGreaterThan(tileCapacity(4, 6));
  });

  it('offers at least the requested floor, even in the shortest card', () => {
    // Better a few overflowing items than an empty block: a card of two rows has no room for
    // three lines, yet it shows three anyway.
    expect(contentCapacity(2, 1000)).toBe(1);
    expect(contentCapacity(2, 1000, 3)).toBe(3);
    expect(listCapacity(2)).toBe(3);
  });
});

describe('the grid packs', () => {
  it('declares the packing and the row height', () => {
    // The packing is the browser's: the rows a short block leaves free are taken by the first
    // following block that fits. Without `dense` they would remain empty — the default the home
    // page carried with `items-start`.
    expect(WIDGET_ROW_GRID_CLASS).toContain('grid-flow-row-dense');
    expect(WIDGET_ROW_GRID_CLASS).toContain('auto-rows-[5rem]');
    expect(WIDGET_ROW_GRID_CLASS).not.toContain('items-start');
  });

  it('writes one span class per offered height', () => {
    // A Tailwind class built by interpolation is purged at build time.
    for (const rows of WIDGET_ROWS) {
      expect(rowSpanClass(rows)).toBe(`row-span-${String(rows)}`);
      expect(rowSpanClass(rows)).not.toContain('${');
    }
  });
});
