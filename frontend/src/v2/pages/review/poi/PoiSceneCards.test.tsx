// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { stubLayoutMetrics } from '../../../../test/layoutMetrics';
import { t } from '../../../i18n';
import PoiSceneCards from './PoiSceneCards';
import { announcePoiAnchors, POI_ANCHOR_ATTR } from './poiAnchor';
import type { PoiSceneCard } from './poiCards';

/**
 * The reviewed comment must be readable IN the scene. This file verifies what the layer does with the
 * viewer's hotspots: it anchors itself to them, opens the first card by default, and never leaves two
 * open, which keeps the view readable when two points are close.
 */
const cards: PoiSceneCard[] = [
  {
    index: 0,
    text: 'la soudure se voit',
    images: [{ src: 'blob:soudure', alt: 'soudure.png' }],
    intro: 'revoir la passe de rendu',
    author: 'Lou',
  },
  { index: 1, text: 'le boulon dépasse', images: [] },
];

/** Viewer container and its hotspots: what `three/objectHotspot` places there for each point. */
function viewer(count: number) {
  const container = document.createElement('div');
  const anchors = Array.from({ length: count }, (_, i) => {
    const pastille = document.createElement('div');
    pastille.setAttribute(POI_ANCHOR_ATTR, String(i));
    container.appendChild(pastille);
    return pastille;
  });
  document.body.appendChild(container);
  return { container, anchors };
}

const openPill = (n: number) => screen.getByRole('button', { name: t('poi.card.open', { n }) });
const closeButton = (n: number) => screen.queryByRole('button', { name: t('poi.card.close', { n }) });

/**
 * The anchored card is the NARROW surface: 15 rem, about twenty characters per line. Folding is measured
 * there, and happy-dom lays nothing out, so we lend it that width.
 */
let restore: (() => void) | null = null;

// Before, not after: React Testing Library's cleanup must unmount the tree (portals and Lightbox
// included) while their nodes are still there: vitest runs the `afterEach` hooks in reverse.
beforeEach(() => {
  document.body.replaceChildren();
  restore = stubLayoutMetrics({ charsPerLine: 22 });
});

afterEach(() => {
  restore?.();
  restore = null;
});

describe('PoiSceneCards — the comment is read at its point', () => {
  it('anchors INSIDE the hotspot of each point: the card follows the projection without projecting itself', () => {
    const { container, anchors } = viewer(2);
    render(<PoiSceneCards containerRef={{ current: container }} cards={cards} />);
    expect(anchors[0].textContent).toContain('revoir la passe de rendu');
    expect(anchors[1].textContent).toContain('le boulon dépasse');
  });

  it('opens the card of the first point by default: the comment is read on arrival', () => {
    const { container } = viewer(2);
    render(<PoiSceneCards containerRef={{ current: container }} cards={cards} />);
    expect(closeButton(1)).toBeInTheDocument();
    expect(screen.getByText('Lou')).toBeInTheDocument();
    // The second point remains a label: it opens on click.
    expect(openPill(2)).toBeInTheDocument();
  });

  it('never leaves two open: opening the second folds the first', () => {
    const { container } = viewer(2);
    render(<PoiSceneCards containerRef={{ current: container }} cards={cards} />);
    fireEvent.click(openPill(2));
    expect(closeButton(2)).toBeInTheDocument();
    expect(closeButton(1)).not.toBeInTheDocument();
    expect(openPill(1)).toBeInTheDocument();
  });

  it('folds back on itself: the open card becomes a label again', () => {
    const { container } = viewer(1);
    render(<PoiSceneCards containerRef={{ current: container }} cards={cards} />);
    fireEvent.click(closeButton(1)!);
    expect(openPill(1)).toBeInTheDocument();
  });

  it('opens an image full size in the shared Lightbox', () => {
    const { container } = viewer(1);
    render(<PoiSceneCards containerRef={{ current: container }} cards={cards} />);
    fireEvent.click(screen.getByRole('button', { name: t('comments.openAttachment') }));
    expect(screen.getByRole('dialog', { name: t('comments.imagePreview') })).toBeInTheDocument();
  });

  it('bounds the open card: three lines, thumbnail beside, the rest on a click', () => {
    const long = '/mnt/prod/seq010/sh0420/comp/v012/sh0420_comp_v012_beauty_linear_exr_sequence';
    const { container } = viewer(1);
    render(
      <PoiSceneCards
        containerRef={{ current: container }}
        cards={[{ index: 0, text: long, images: cards[0].images }]}
      />,
    );
    // The card does not hide the scene: it is cut at three lines, and unfolds on click.
    expect(container.querySelector('.line-clamp-3')).not.toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: t('comments.expandComment', { count: long.length }) }),
    );
    expect(container.querySelector('.line-clamp-3')).toBeNull();
    // The thumbnail lives in the same row as the text: beside, not below.
    const strip = screen.getByRole('img').closest('div');
    expect(strip?.parentElement?.firstElementChild?.textContent).toContain(long);
    expect(strip?.className).toContain('shrink-0');
  });

  it('waits for its hotspot: a point the viewer has not yet projected renders nothing', () => {
    const { container } = viewer(0);
    render(<PoiSceneCards containerRef={{ current: container }} cards={cards} />);
    expect(closeButton(1)).not.toBeInTheDocument();
    // The hotspot arrives at the first drawn frame; the marker's announcement wakes the layer.
    const pastille = document.createElement('div');
    pastille.setAttribute(POI_ANCHOR_ATTR, '0');
    act(() => {
      container.appendChild(pastille);
      announcePoiAnchors(container);
    });
    expect(closeButton(1)).toBeInTheDocument();
  });

  it('without a mounted viewer, the layer renders nothing and does not throw', () => {
    expect(() => render(<PoiSceneCards containerRef={{ current: null }} cards={cards} />)).not.toThrow();
    expect(closeButton(1)).not.toBeInTheDocument();
  });
});
