// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  arrowHead,
  ellipseFromCorners,
  hitShape,
  normalizeRect,
  translateShape,
  type Shape,
} from './geometry';

describe('arrowHead', () => {
  it('horizontal arrow: symmetric head, tip at the endpoint', () => {
    const h = arrowHead(0.1, 0.5, 0.9, 0.5, { w: 1000, h: 1000 }, 4);
    expect(h).not.toBeNull();
    expect(h!.tip).toEqual([0.9, 0.5]);
    // Symmetric wings around the axis.
    expect(h!.left[1] + h!.right[1]).toBeCloseTo(1, 6);
    expect(h!.left[0]).toBeCloseTo(h!.right[0], 6);
    // The base is behind the tip.
    expect(h!.left[0]).toBeLessThan(0.9);
  });

  it('not distorted by a non-square canvas (computed in screen space)', () => {
    // Vertical arrow in a very wide canvas: the head half-width, in px,
    // must be identical to that of a horizontal arrow of the same thickness.
    const size = { w: 2000, h: 500 };
    const vert = arrowHead(0.5, 0.1, 0.5, 0.9, size, 4)!;
    const horiz = arrowHead(0.1, 0.5, 0.9, 0.5, size, 4)!;
    const wVert = Math.abs(vert.left[0] - vert.right[0]) * size.w;
    const wHoriz = Math.abs(horiz.left[1] - horiz.right[1]) * size.h;
    expect(wVert).toBeCloseTo(wHoriz, 4);
  });

  it('size bounded by the length of the stroke, and null if degenerate', () => {
    const size = { w: 1000, h: 1000 };
    const tiny = arrowHead(0.5, 0.5, 0.52, 0.5, size, 12)!;
    // headLen ≤ 45% of the length (20 px) → base ≥ x=0.51.
    expect(tiny.left[0]).toBeGreaterThanOrEqual(0.51 - 1e-6);
    expect(arrowHead(0.5, 0.5, 0.5, 0.5, size, 4)).toBeNull();
    expect(arrowHead(0, 0, 1, 1, { w: 0, h: 0 }, 4)).toBeNull();
  });
});

describe('hitShape', () => {
  const arrow: Shape = {
    id: 'a',
    type: 'arrow',
    color: '#fff',
    width: 3,
    x1: 0.2,
    y1: 0.5,
    x2: 0.8,
    y2: 0.5,
  };
  it('hits an arrow along its whole length (not just the tip)', () => {
    expect(hitShape([arrow], [0.5, 0.51])?.id).toBe('a');
    expect(hitShape([arrow], [0.5, 0.6])).toBeUndefined();
  });
  it('priority to the last shape drawn', () => {
    const r1: Shape = { id: 'r1', type: 'rect', color: '#fff', width: 3, x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
    const r2: Shape = { ...r1, id: 'r2' };
    expect(hitShape([r1, r2], [0.5, 0.5])?.id).toBe('r2');
  });
});

describe('ellipseFromCorners', () => {
  it('inscribes the ellipse in the rectangle of the two corners', () => {
    const e = ellipseFromCorners([0.2, 0.3], [0.6, 0.5]);
    expect(e.cx).toBeCloseTo(0.4, 10);
    expect(e.cy).toBeCloseTo(0.4, 10);
    expect(e.rx).toBeCloseTo(0.2, 10);
    expect(e.ry).toBeCloseTo(0.1, 10);
  });
  it('independent of the drawing direction (bottom-right to top-left corner)', () => {
    expect(ellipseFromCorners([0.6, 0.5], [0.2, 0.3])).toEqual(ellipseFromCorners([0.2, 0.3], [0.6, 0.5]));
  });
  it('degenerate at the starting point: zero radii centred on the corner', () => {
    expect(ellipseFromCorners([0.5, 0.5], [0.5, 0.5])).toEqual({ cx: 0.5, cy: 0.5, rx: 0, ry: 0 });
  });
});

describe('translateShape / normalizeRect', () => {
  it('translates a whole arrow', () => {
    const s: Shape = { id: 'a', type: 'arrow', color: '#fff', width: 3, x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.3 };
    const t = translateShape(s, 0.1, -0.05);
    expect(t.x1).toBeCloseTo(0.2);
    expect(t.y2).toBeCloseTo(0.25);
  });
  it('normalizes a rect drawn backwards', () => {
    const s: Shape = { id: 'r', type: 'rect', color: '#fff', width: 3, x: 0.5, y: 0.5, w: -0.2, h: -0.1 };
    const n = normalizeRect(s);
    expect(n).toMatchObject({ x: 0.3, y: 0.4, w: 0.2, h: 0.1 });
  });
  it('translates a polygon (all vertices), 42.B №90', () => {
    const s: Shape = {
      id: 'poly',
      type: 'polygon',
      color: '#fff',
      width: 3,
      pts: [
        [0.1, 0.1],
        [0.3, 0.1],
        [0.2, 0.3],
      ],
    };
    const t = translateShape(s, 0.05, 0.1);
    expect(t.pts).toEqual([
      [0.15000000000000002, 0.2],
      [0.35, 0.2],
      [0.25, 0.4],
    ]);
  });
});

describe('hitShape — polygone (42.B №90)', () => {
  const poly: Shape = {
    id: 'poly',
    type: 'polygon',
    color: '#fff',
    width: 3,
    pts: [
      [0.2, 0.2],
      [0.6, 0.2],
      [0.4, 0.6],
    ],
  };
  it('hits near a vertex', () => {
    expect(hitShape([poly], [0.21, 0.21])?.id).toBe('poly');
  });
  it('does not hit far from the vertices', () => {
    expect(hitShape([poly], [0.9, 0.9])).toBeUndefined();
  });
});
