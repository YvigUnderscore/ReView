// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { buildPoiSceneCards, poiCardAbove, poiCardSide, POI_CARD_HALF_PX } from './poiCards';
import type { PoiPoint } from './poiPoints';

const attachments = [
  { key: 'k1', name: 'soudure.png', contentType: 'image/png', url: 'blob:soudure' },
  { key: 'k2', name: 'boulon.png', contentType: 'image/png', url: 'blob:boulon' },
  { key: 'k3', name: 'note.pdf', contentType: 'application/pdf', url: 'blob:pdf' },
];

const points: PoiPoint[] = [
  { position: '0 0 0', normal: '0 0 1', space: 'object', text: 'la soudure se voit', images: ['k1'] },
  { position: '1 0 0', normal: '0 0 1', space: 'object', text: 'le boulon dépasse' },
];

describe('buildPoiSceneCards — the reviewed comment, spread over its points', () => {
  it('gives each point its remark and ITS images, recognised by their key', () => {
    const cards = buildPoiSceneCards({ points, attachments });
    expect(cards.map((c) => c.index)).toEqual([0, 1]);
    expect(cards[0].text).toBe('la soudure se voit');
    expect(cards[0].images.map((i) => i.alt)).toEqual(['soudure.png', 'boulon.png']);
    expect(cards[1].text).toBe('le boulon dépasse');
    expect(cards[1].images).toEqual([]);
  });

  it("places on the FIRST card the author's word and the images no point claims", () => {
    const cards = buildPoiSceneCards({
      points,
      attachments,
      intro: '  revoir la passe de rendu  ',
      author: 'Lou',
    });
    expect(cards[0].intro).toBe('revoir la passe de rendu');
    expect(cards[0].author).toBe('Lou');
    // `k2` belongs to no point: it joins the first card. `k3` is a PDF.
    expect(cards[0].images.map((i) => i.src)).toEqual(['blob:soudure', 'blob:boulon']);
    expect(cards[1].intro).toBeUndefined();
    expect(cards[1].author).toBeUndefined();
  });

  it('does not place a card on a point that has nothing to read', () => {
    const bare: PoiPoint[] = [
      { position: '0 0 0', normal: '0 0 1' },
      { position: '1 0 0', normal: '0 0 1', text: 'ici' },
    ];
    const cards = buildPoiSceneCards({ points: bare });
    expect(cards.map((c) => c.index)).toEqual([1]);
  });

  it('makes a comment predating the points readable: its single point carries everything', () => {
    // `readPoiPoints` renders the `hotspot` of an old comment as point no. 1, without text.
    const legacy: PoiPoint[] = [{ position: '0 0 0', normal: '0 0 1' }];
    const cards = buildPoiSceneCards({
      points: legacy,
      attachments,
      intro: 'le raccord saute',
      author: 'Lou',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].intro).toBe('le raccord saute');
    expect(cards[0].images).toHaveLength(2);
  });

  it('keeps only the displayable images as attachments', () => {
    const [card] = buildPoiSceneCards({
      points: [{ position: '0 0 0', normal: '0 0 1', text: 'un défaut', images: ['k3'] }],
      attachments: [attachments[2]],
    });
    // The comment's PDF is read in the thread, not as a thumbnail above the scene.
    expect(card.images).toEqual([]);
    expect(card.text).toBe('un défaut');
  });
});

describe('poiCardSide — the open card fits in the viewer, which clips what overflows', () => {
  it('centres under its hotspot when there is room on every side', () => {
    expect(poiCardSide(400, 800)).toBe('center');
  });

  it('is pushed right near the left edge, and left near the right edge', () => {
    expect(poiCardSide(10, 800)).toBe('right');
    expect(poiCardSide(790, 800)).toBe('left');
  });

  it('flips exactly at half the width of the card', () => {
    expect(poiCardSide(POI_CARD_HALF_PX - 1, 800)).toBe('right');
    expect(poiCardSide(POI_CARD_HALF_PX, 800)).toBe('center');
  });
});

describe('poiCardAbove — a point at the bottom edge is commented above', () => {
  it('stays under its hotspot as long as the card fits beneath', () => {
    expect(poiCardAbove(100, 900)).toBe(false);
  });

  it('goes above when there is not enough room beneath and more room above', () => {
    expect(poiCardAbove(860, 900)).toBe(true);
  });

  it('does not go above in a viewer too short for it: both edges clip the same way', () => {
    // 120 px under the hotspot, 30 px above: raising the card would gain nothing.
    expect(poiCardAbove(30, 150)).toBe(false);
  });
});
