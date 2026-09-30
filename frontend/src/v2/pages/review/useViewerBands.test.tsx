// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useViewerBands, viewerCanvas } from './useViewerBands';
import { MEDIA_CANVAS, type ViewerBands } from './referenceBox';

/**
 * Les bandes se mesurent sur les **aspects** (média, zone qui rogne) et jamais sur les deux
 * boîtes : le média zoomé déborde le viewer, et une mesure en pixels rapatrierait les
 * références sur l'image au premier cran de molette.
 */
const RECTS: Record<string, { width: number; height: number }> = {};
const original = Element.prototype.getBoundingClientRect;

/** Géométrie imposée avant le rendu : la mesure a lieu dès le montage du calque. */
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
  it('mesure les bandes latérales d’un viewer plus large que le média', () => {
    geometry({ width: 400, height: 400 }, { width: 800, height: 400 });
    render(<Host />);
    expect(bands()).toEqual({ left: 0.5, right: 0.5, top: 0, bottom: 0 });
  });

  it('mesure les bandes haut/bas d’un média plus large que le viewer', () => {
    geometry({ width: 800, height: 400 }, { width: 400, height: 400 });
    render(<Host />);
    expect(bands()).toEqual({ left: 0, right: 0, top: 0.5, bottom: 0.5 });
  });

  it('ne mesure rien sans ancêtre qui rogne : le cadre du média pour seule zone', () => {
    geometry({ width: 400, height: 400 }, { width: 800, height: 400 });
    render(<Host clipped={false} />);
    expect(bands()).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('ne mesure rien d’un conteneur sans hauteur', () => {
    geometry({ width: 0, height: 0 }, { width: 0, height: 0 });
    render(<Host />);
    expect(bands()).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});

/**
 * Le canevas, lui, se mesure **en pixels et en position** : c'est ce que le viewer montre au
 * zoom courant, et c'est là qu'une référence peut aller sans devenir insaisissable.
 */
describe('viewerCanvas', () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
  const planted: HTMLElement[] = [];

  /** Un calque épousant le média, dans un viewer qui rogne (ou non) ce qui dépasse. */
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

  it('donne la zone visible en fractions du média, letterbox compris', () => {
    // Média 400×300 au centre d'un viewer 1200×600 : une largeur de média libre de chaque côté,
    // une demi-hauteur en haut comme en bas.
    const layer = layerIn(rect(400, 150, 400, 300), rect(0, 0, 1200, 600));
    expect(viewerCanvas(layer)).toEqual({ left: -1, top: -0.5, right: 2, bottom: 1.5 });
  });

  it('s’en tient au cadre du média quand rien ne rogne', () => {
    expect(viewerCanvas(layerIn(rect(0, 0, 400, 300)))).toEqual(MEDIA_CANVAS);
  });

  it('s’en tient au cadre du média quand rien n’est mesurable', () => {
    expect(viewerCanvas(layerIn(rect(0, 0, 0, 0), rect(0, 0, 1200, 600)))).toEqual(MEDIA_CANVAS);
  });
});
