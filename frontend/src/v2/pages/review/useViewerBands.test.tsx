// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useViewerBands } from './useViewerBands';
import type { ViewerBands } from './referenceBox';

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
