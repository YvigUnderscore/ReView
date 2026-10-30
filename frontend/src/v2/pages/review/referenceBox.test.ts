// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  fitBands,
  MEDIA_CANVAS,
  NO_BANDS,
  onCanvasRefBox,
  pastedRefBox,
  placeRefBox,
  REF_MIN_WIDTH,
  REF_PASTE_WIDTH,
  REF_POS_LIMIT,
  rescueRefBox,
  type ViewerBands,
} from './referenceBox';

/**
 * Three bounding schemes succeeded one another, and none made the gesture free. The paste first placed
 * at x = 1.05 with no limit (invisible, unrecoverable), then everything was bounded to 0..1 (the reference
 * snapped automatically ONTO the image), then to the letterbox bands, which still forbid the sides as soon
 * as the letterbox is horizontal.
 *
 * The rule now holds both ends by separating the two moments: the gesture knows no band (`placeRefBox`),
 * and the display only rescues what no viewer would show (`rescueRefBox`).
 */
const bands = (over: Partial<ViewerBands> = {}): ViewerBands => ({ ...NO_BANDS, ...over });
const SIDE = bands({ left: 0.5, right: 0.5 });
const VERTICAL = bands({ top: 0.4, bottom: 0.4 });

describe('fitBands', () => {
  it('gives side bands when the viewer is wider than the media', () => {
    expect(fitBands(1, 2)).toEqual({ left: 0.5, right: 0.5, top: 0, bottom: 0 });
  });

  it('gives top/bottom bands when the media is wider than the viewer', () => {
    expect(fitBands(2, 1)).toEqual({ left: 0, right: 0, top: 0.5, bottom: 0.5 });
  });

  it('gives no band when the two aspects coincide', () => {
    expect(fitBands(16 / 9, 16 / 9)).toEqual(NO_BANDS);
  });

  it('gives no band for lack of a measurement (container without height)', () => {
    expect(fitBands(NaN, 2)).toEqual(NO_BANDS);
    expect(fitBands(1, 0)).toEqual(NO_BANDS);
  });

  it('caps an outsized band at the reachable overflow', () => {
    expect(fitBands(0.01, 10).right).toBe(REF_POS_LIMIT);
  });
});

describe('placeRefBox', () => {
  it('keeps the drop point as it is, outside the media frame as inside', () => {
    expect(placeRefBox({ x: 1.4, y: -0.6, width: 0.3 })).toEqual({ x: 1.4, y: -0.6, width: 0.3 });
    expect(placeRefBox({ x: 0.2, y: 0.3, width: 0.4 })).toEqual({ x: 0.2, y: 0.3, width: 0.4 });
  });

  it('keeps a drop well beyond the frame: no band enters the gesture', () => {
    expect(placeRefBox({ x: 2.5, y: 1.8, width: 0.3 })).toEqual({ x: 2.5, y: 1.8, width: 0.3 });
  });

  it('stops at the ceiling shared with the server, which would refuse the submission', () => {
    expect(placeRefBox({ x: 9, y: -9, width: 0.3 })).toEqual({
      x: REF_POS_LIMIT,
      y: -REF_POS_LIMIT,
      width: 0.3,
    });
  });

  it('caps the width at the image and keeps a graspable size', () => {
    expect(placeRefBox({ x: 0, y: 0, width: 3 }).width).toBe(1);
    expect(placeRefBox({ x: 0.5, y: 0.5, width: 0 }).width).toBe(REF_MIN_WIDTH);
  });

  it('does not propagate a NaN coming from a drag over an unmeasured container', () => {
    expect(placeRefBox({ x: NaN, y: NaN, width: NaN })).toEqual({
      x: 0,
      y: 0,
      width: REF_MIN_WIDTH,
    });
  });
});

describe('onCanvasRefBox', () => {
  /** What a viewer wider and taller than the media measures: room all around. */
  const CANVAS = { left: -1, top: -0.5, right: 2, bottom: 1.5 };

  it('leaves the reference anywhere on the canvas, outside the media frame', () => {
    expect(onCanvasRefBox({ x: 1.6, y: -0.4, width: 0.3 }, 0.4, CANVAS)).toEqual({
      x: 1.6,
      y: -0.4,
      width: 0.3,
    });
  });

  it('holds at the edge whatever would leave the viewer, hence out of reach', () => {
    expect(onCanvasRefBox({ x: 2.5, y: 0, width: 0.3 }, 0.4, CANVAS).x).toBeCloseTo(1.95);
    expect(onCanvasRefBox({ x: -2, y: 0, width: 0.3 }, 0.4, CANVAS).x).toBeCloseTo(-1.25);
    expect(onCanvasRefBox({ x: 0, y: 2.5, width: 0.3 }, 0.4, CANVAS).y).toBeCloseTo(1.45);
    expect(onCanvasRefBox({ x: 0, y: -2, width: 0.3 }, 0.4, CANVAS).y).toBeCloseTo(-0.85);
  });

  it('sticks to the media frame for lack of a measured canvas', () => {
    const box = onCanvasRefBox({ x: 1.6, y: 0.2, width: 0.3 }, 0.4, MEDIA_CANVAS);
    expect(box.x).toBeCloseTo(0.95);
  });

  it('falls back on the graspable part when the height cannot be measured', () => {
    expect(onCanvasRefBox({ x: 0, y: -2, width: 0.3 }, 0, CANVAS).y).toBeCloseTo(-0.5);
    expect(onCanvasRefBox({ x: 0, y: -2, width: 0.3 }, NaN, CANVAS).y).toBeCloseTo(-0.5);
  });

  it('never exceeds the ceiling the server accepts, huge canvas or not', () => {
    const huge = { left: -20, top: -20, right: 20, bottom: 20 };
    expect(onCanvasRefBox({ x: 40, y: -40, width: 0.3 }, 0.4, huge)).toEqual({
      x: REF_POS_LIMIT,
      y: -REF_POS_LIMIT,
      width: 0.3,
    });
  });
});

describe('rescueRefBox', () => {
  it('leaves exactly in place a reference of which enough is visible', () => {
    expect(rescueRefBox({ x: 0.2, y: 0.3, width: 0.4 })).toEqual({ x: 0.2, y: 0.3, width: 0.4 });
    expect(rescueRefBox({ x: 1.1, y: 0.2, width: 0.3 }, SIDE).x).toBeCloseTo(1.1);
    expect(rescueRefBox({ x: -0.4, y: 0.2, width: 0.3 }, SIDE).x).toBeCloseTo(-0.4);
    expect(rescueRefBox({ x: 0.2, y: -0.4, width: 0.3 }, VERTICAL).y).toBeCloseTo(-0.4);
  });

  it("lets the viewer's reference overflow as long as a part of it is recognised", () => {
    expect(rescueRefBox({ x: 1.4, y: 0.2, width: 0.3 }, SIDE).x).toBeCloseTo(1.4);
  });

  it('brings back into the visible zone what no longer bites enough into it', () => {
    expect(rescueRefBox({ x: 1.45, y: 0, width: 0.3 }, SIDE).x).toBeCloseTo(1.2);
    expect(rescueRefBox({ x: 5, y: 0, width: 0.3 }, SIDE).x).toBeCloseTo(1.2);
    expect(rescueRefBox({ x: -5, y: 0, width: 0.3 }, SIDE).x).toBeCloseTo(-0.5);
    expect(rescueRefBox({ x: 0.2, y: -3, width: 0.3 }, VERTICAL).y).toBeCloseTo(-0.4);
    expect(rescueRefBox({ x: 0.2, y: 9, width: 0.3 }, VERTICAL).y).toBeCloseTo(1.35);
  });

  it('brings back into the frame an inherited position when no band hosts it', () => {
    const box = rescueRefBox({ x: 1.05, y: 0, width: 0.3 });
    expect(box.x).toBeCloseTo(0.7);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
    // A band too short to show a recognisable part of the reference is not enough either.
    expect(rescueRefBox({ x: 1.05, y: 0, width: 0.3 }, bands({ right: 0.1 })).x).toBeCloseTo(0.8);
  });

  it('rescues an aberrant inherited position on both axes', () => {
    expect(rescueRefBox({ x: -2, y: -1, width: 0.2 })).toEqual({ x: 0, y: 0, width: 0.2 });
    expect(rescueRefBox({ x: 0, y: 4, width: 0.2 }).y).toBeLessThan(1);
  });

  it('caps an outsized band: the reference remains rescuable', () => {
    expect(rescueRefBox({ x: -99, y: 0, width: 0.3 }, bands({ left: 99 })).x).toBe(-REF_POS_LIMIT);
  });

  it('does not propagate a NaN recorded in the database', () => {
    expect(rescueRefBox({ x: NaN, y: NaN, width: NaN })).toEqual({
      x: 0,
      y: 0,
      width: REF_MIN_WIDTH,
    });
  });
});

describe('pastedRefBox', () => {
  it('places the reference BESIDE the media when the right band hosts it', () => {
    const box = pastedRefBox(0, SIDE);
    expect(box.x).toBeGreaterThanOrEqual(1);
    expect(box.x + box.width).toBeLessThanOrEqual(1 + SIDE.right);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  it('falls back on the left band when it is the only one available', () => {
    const box = pastedRefBox(0, bands({ left: 0.6 }));
    expect(box.x + box.width).toBeLessThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(-0.6);
  });

  it('places it BELOW the media when the letterbox is horizontal', () => {
    const box = pastedRefBox(0, bands({ top: 0.6, bottom: 0.6 }));
    expect(box.y).toBeGreaterThan(1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
  });

  it('places it ABOVE the media when only the top band hosts it', () => {
    expect(pastedRefBox(0, bands({ top: 0.6 })).y).toBeLessThan(0);
  });

  it('falls back on a corner of the media when nothing surrounds it', () => {
    const box = pastedRefBox(0);
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
    expect(box.y).toBeGreaterThan(0);
    expect(box.y).toBeLessThan(0.5);
  });

  it('also falls back on a corner when the band is too short for the reference', () => {
    expect(pastedRefBox(0, bands({ right: REF_PASTE_WIDTH / 2 })).x).toBeLessThan(1);
    const flat = pastedRefBox(0, bands({ top: 0.2, bottom: 0.2 }));
    expect(flat.y).toBeGreaterThan(0);
    expect(flat.y).toBeLessThan(0.5);
  });

  it('cascades along the band without leaving it', () => {
    const first = pastedRefBox(0, SIDE);
    const second = pastedRefBox(1, SIDE);
    expect(second.x).toBeCloseTo(first.x);
    expect(second.y).toBeGreaterThan(first.y);
    for (let i = 0; i < 12; i++) {
      const box = pastedRefBox(i, SIDE);
      expect(box.x + box.width).toBeLessThanOrEqual(1 + SIDE.right);
      expect(box.y).toBeLessThan(1);
    }
  });

  it('cascades on the media, within the frame, when there is no band', () => {
    for (let i = 0; i < 12; i++) {
      const box = pastedRefBox(i);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1);
      expect(box.y).toBeLessThan(1);
    }
    expect(pastedRefBox(1).x).toBeGreaterThan(pastedRefBox(0).x);
  });
});
