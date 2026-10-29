// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { WidgetSpan } from '@/v2/lib/widgetLayout';
import {
  FALLBACK_GEOMETRY,
  OVERVIEW_GRID_CLASS,
  OVERVIEW_ROWS,
  listCapacity,
  resizeTarget,
  resolveRows,
  rowSpanClass,
  stepSize,
  tileCapacity,
  type WidgetSize,
} from './overviewSizing';

/**
 * The geometry of the overview, verified without a screen.
 *
 * Three promises are at stake here and nowhere else: a gesture never produces a size the block does
 * not offer, a height saved before this batch stays readable, and a taller card really announces
 * more lines. Otherwise enlarging it would merely move the empty space.
 */

const SPANS: WidgetSpan[] = [4, 6, 8, 12];
const start: WidgetSize = { span: 6, rows: 3 };
const drag = (dx: number, dy: number, spans = SPANS) =>
  resizeTarget(start, { dx, dy }, FALLBACK_GEOMETRY, spans);

describe('resizeTarget', () => {
  it('translates a horizontal drag into columns', () => {
    // Two columns to the right: 6 + 2 = 8, a width that the block offers.
    expect(drag(2 * FALLBACK_GEOMETRY.column, 0).span).toBe(8);
    expect(drag(-2 * FALLBACK_GEOMETRY.column, 0).span).toBe(4);
  });

  it('translates a vertical drag into rows', () => {
    expect(drag(0, 2 * FALLBACK_GEOMETRY.row).rows).toBe(5);
    expect(drag(0, -FALLBACK_GEOMETRY.row).rows).toBe(2);
  });

  it('sets both axes in a single gesture', () => {
    expect(drag(FALLBACK_GEOMETRY.column, FALLBACK_GEOMETRY.row)).toEqual({ span: 8, rows: 4 });
  });

  it('breaks ties in the direction of the gesture', () => {
    // The width scale jumps by two: dragging by a single column lands exactly between two notches.
    // Without arbitration, the handle would not respond to that gesture.
    expect(drag(FALLBACK_GEOMETRY.column, 0).span).toBe(8);
    expect(drag(-FALLBACK_GEOMETRY.column, 0).span).toBe(4);
  });

  it('does not move until the gesture has crossed half a notch', () => {
    expect(drag(FALLBACK_GEOMETRY.column / 3, FALLBACK_GEOMETRY.row / 3)).toEqual(start);
  });

  it('bounds to the sizes offered, however far one drags', () => {
    // This is the promise of the notch: a grid stays readable because no gesture produces a
    // footprint that the page cannot render.
    expect(drag(5000, 5000)).toEqual({ span: 12, rows: 6 });
    expect(drag(-5000, -5000)).toEqual({ span: 4, rows: 2 });
  });

  it('ignores the widths that this block does not offer', () => {
    // A media block does not go below half the page: dragging to the left stops at 6, not at
    // 4.
    expect(drag(-5000, 0, [6, 8, 12]).span).toBe(6);
    expect(drag(-FALLBACK_GEOMETRY.column, 0, [6, 8, 12]).span).toBe(6);
  });
});

describe('stepSize — the same setting by keyboard', () => {
  it('moves one notch along the requested axis', () => {
    expect(stepSize(start, 'span', 1, SPANS)).toEqual({ span: 8, rows: 3 });
    expect(stepSize(start, 'span', -1, SPANS)).toEqual({ span: 4, rows: 3 });
    expect(stepSize(start, 'rows', 1, SPANS)).toEqual({ span: 6, rows: 4 });
    expect(stepSize(start, 'rows', -1, SPANS)).toEqual({ span: 6, rows: 2 });
  });

  it('does not leave the scale at its bounds', () => {
    expect(stepSize({ span: 12, rows: 6 }, 'span', 1, SPANS)).toEqual({ span: 12, rows: 6 });
    expect(stepSize({ span: 12, rows: 6 }, 'rows', 1, SPANS)).toEqual({ span: 12, rows: 6 });
    expect(stepSize({ span: 4, rows: 2 }, 'rows', -1, SPANS)).toEqual({ span: 4, rows: 2 });
  });
});

describe('resolveRows', () => {
  it('takes the saved height', () => {
    expect(resolveRows({ rows: 5 }, 3)).toBe(5);
  });

  it('reads back the old scale of a layout saved before the rows', () => {
    // The aim is not to convert the preferences (they are not rewritten), but not to lose the tall
    // block someone had set.
    expect(resolveRows({ height: 'tall' }, 3)).toBe(5);
    expect(resolveRows({ height: 'short' }, 4)).toBe(2);
    expect(resolveRows({ height: 'normal' }, 6)).toBe(3);
  });

  it('treats an absent height as the block default', () => {
    expect(resolveRows(undefined, 4)).toBe(4);
    expect(resolveRows({ span: 12 }, 2)).toBe(2);
  });

  it('ignores a height outside the scale rather than applying it wrongly', () => {
    expect(resolveRows({ rows: 9 }, 3)).toBe(3);
    expect(resolveRows({ rows: 0 }, 3)).toBe(3);
  });

  it('prefers rows over the old scale when both are present', () => {
    expect(resolveRows({ rows: 6, height: 'short' }, 3)).toBe(6);
  });
});

describe('content follows the size', () => {
  it('shows more lines in a taller card', () => {
    const lines = OVERVIEW_ROWS.map((rows) => listCapacity(rows));
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(new Set(lines).size).toBe(lines.length);
    expect(listCapacity(6)).toBeGreaterThan(2 * listCapacity(2));
  });

  it('shows more thumbnails in a taller or wider card', () => {
    expect(tileCapacity(6, 12)).toBeGreaterThan(tileCapacity(2, 12));
    expect(tileCapacity(4, 12)).toBeGreaterThan(tileCapacity(4, 6));
    // The smallest card shows at least one complete row of thumbnails.
    expect(tileCapacity(2, 6)).toBe(4);
  });
});

describe('the grid packs', () => {
  it('declares the packing and the row height', () => {
    // The packing is the browser's: the rows a short block leaves free are taken by the first
    // following block that fits there. Without `dense` they would remain empty: this is the defect
    // circled in red.
    expect(OVERVIEW_GRID_CLASS).toContain('grid-flow-row-dense');
    expect(OVERVIEW_GRID_CLASS).toContain('auto-rows-[5rem]');
  });

  it('writes one footprint class per height offered', () => {
    for (const rows of OVERVIEW_ROWS) expect(rowSpanClass(rows)).toBe(`row-span-${String(rows)}`);
  });
});
