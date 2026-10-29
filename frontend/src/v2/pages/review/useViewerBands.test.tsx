// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useViewerBands, viewerCanvas } from './useViewerBands';
import { MEDIA_CANVAS, type ViewerBands } from './referenceBox';

/**
 * Bands are measured from the **aspects** (media, clipping area) and never from the two boxes: the
 * zoomed media overflows the viewer, and a pixel measurement would pull the references back onto the
 * image at the first wheel notch.
 */
const RECTS: Record<string, { width: number; height: number }> = {};
const original = Element.prototype.getBoundingClientRect;

/** Geometry imposed before rendering: the measurement happens as soon as the layer is mounted. */
function geometry(media: { width: number; height: number }, clip: { width: number; height: number }) {
  RECTS.media = media;
  RECTS.clip = clip;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const box = RECTS[this.getAttribute('data-testid') ?? ''] ?? { width: 0, height: 0 };
    return { ...box, x: 0, y: 0, top: 0, left: 0, right: box.width, bottom: box.height } as DOMRect;
  };
}

function Host({ clipped = true }: { clipped?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const bands = useViewerBands(ref);
  return (
    <div data-testid="clip" style={{ overflow: clipped ? 'hidden' : 'visible' }}>
      <div data-testid="media" ref={ref} />
      <div data-testid="bands">{JSON.stringify(bands)}</div>
    </div>
  );
}

const bands = (): ViewerBands => {
  const raw: unknown = JSON.parse(screen.getByTestId('bands').textContent ?? '{}');
  return raw as ViewerBands;
};

afterEach(() => {
  Element.prototype.getBoundingClientRect = original;
});

describe('useViewerBands', () => {
  it('measures the side bands of a viewer wider than the media', () => {
    geometry({ width: 400, height: 400 }, { width: 800, height: 400 });
    render(<Host />);
    expect(bands()).toEqual({ left: 0.5, right: 0.5, top: 0, bottom: 0 });
  });

  it('measures the top/bottom bands of a media wider than the viewer', () => {
    geometry({ width: 800, height: 400 }, { width: 400, height: 400 });
    render(<Host />);
    expect(bands()).toEqual({ left: 0, right: 0, top: 0.5, bottom: 0.5 });
  });

  it('measures nothing without a clipping ancestor: the media frame as the sole area', () => {
    geometry({ width: 400, height: 400 }, { width: 800, height: 400 });
    render(<Host clipped={false} />);
    expect(bands()).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('measures nothing of a container without height', () => {
    geometry({ width: 0, height: 0 }, { width: 0, height: 0 });
    render(<Host />);
    expect(bands()).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});

/**
 * The canvas, for its part, is measured **in pixels and in position**: that is what the viewer shows
 * at the current zoom, and it is where a reference can go without becoming ungraspable.
 */
describe('viewerCanvas', () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
  const planted: HTMLElement[] = [];

  /** A layer matching the media, in a viewer that clips (or not) what overflows. */
  const layerIn = (media: DOMRect, clip?: DOMRect) => {
    const viewer = document.createElement('div');
    if (clip) {
      viewer.style.overflow = 'hidden';
      viewer.getBoundingClientRect = () => clip;
    }
    const layer = document.createElement('div');
    layer.getBoundingClientRect = () => media;
    viewer.appendChild(layer);
    document.body.appendChild(viewer);
    planted.push(viewer);
    return layer;
  };

  afterEach(() => {
    for (const el of planted.splice(0)) el.remove();
  });

  it('gives the visible area in fractions of the media, letterbox included', () => {
    // Media 400×300 centered in a 1200×600 viewer: a free media width on each side,
    // half a height at the top and at the bottom.
    const layer = layerIn(rect(400, 150, 400, 300), rect(0, 0, 1200, 600));
    expect(viewerCanvas(layer)).toEqual({ left: -1, top: -0.5, right: 2, bottom: 1.5 });
  });

  it('sticks to the media frame when nothing clips', () => {
    expect(viewerCanvas(layerIn(rect(0, 0, 400, 300)))).toEqual(MEDIA_CANVAS);
  });

  it('sticks to the media frame when nothing is measurable', () => {
    expect(viewerCanvas(layerIn(rect(0, 0, 0, 0), rect(0, 0, 1200, 600)))).toEqual(MEDIA_CANVAS);
  });
});
