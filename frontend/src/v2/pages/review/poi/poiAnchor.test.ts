// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  announcePoiAnchors,
  isPoiCardGesture,
  POI_ANCHOR_ATTR,
  POI_CARD_ATTR,
  poiAnchors,
  sameAnchors,
  subscribePoiAnchors,
} from './poiAnchor';

/** Viewer container, with the hotspots the marker places in it (placed here by hand). */
function viewerWith(...ranks: number[]) {
  const container = document.createElement('div');
  for (const rank of ranks) {
    const pastille = document.createElement('div');
    pastille.setAttribute(POI_ANCHOR_ATTR, String(rank));
    container.appendChild(pastille);
  }
  document.body.appendChild(container);
  return container;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('poiAnchors — hotspots are read by their rank, not by DOM order', () => {
  it('sorts the hotspots by rank: the list index IS the rank of the point', () => {
    const container = viewerWith(2, 0, 1);
    expect(poiAnchors(container).map((el) => el.getAttribute(POI_ANCHOR_ATTR))).toEqual(['0', '1', '2']);
  });

  it('without a container, the list is empty: the layer may mount before the viewer', () => {
    expect(poiAnchors(null)).toEqual([]);
  });
});

describe('subscribePoiAnchors — the layer mounts both before and after the hotspots', () => {
  it('plays the callback immediately with the hotspots already placed', () => {
    const container = viewerWith(0, 1);
    const seen = vi.fn();
    subscribePoiAnchors(container, seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0]).toHaveLength(2);
  });

  it('replays it at each announcement of the marker: one more hotspot is seen', () => {
    const container = viewerWith();
    const seen = vi.fn();
    subscribePoiAnchors(container, seen);
    expect(seen.mock.calls[0][0]).toEqual([]);
    const pastille = document.createElement('div');
    pastille.setAttribute(POI_ANCHOR_ATTR, '0');
    container.appendChild(pastille);
    announcePoiAnchors(container);
    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen.mock.calls[1][0]).toEqual([pastille]);
  });

  it('unsubscribes: an unmounted layer no longer receives anything', () => {
    const container = viewerWith(0);
    const seen = vi.fn();
    subscribePoiAnchors(container, seen)();
    announcePoiAnchors(container);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('without a container, unsubscribing remains callable', () => {
    const seen = vi.fn();
    expect(() => subscribePoiAnchors(null, seen)()).not.toThrow();
    expect(seen).toHaveBeenCalledWith([]);
  });
});

describe('sameAnchors — a layer does not resubscribe for an identical list', () => {
  it('compares node by node, in order', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    expect(sameAnchors([a, b], [a, b])).toBe(true);
    expect(sameAnchors([a, b], [b, a])).toBe(false);
    expect(sameAnchors([a], [a, b])).toBe(false);
  });
});

describe('isPoiCardGesture — reading an anchored comment is not navigating', () => {
  it('recognises a gesture starting from the card, or from anything inside it', () => {
    const card = document.createElement('div');
    card.setAttribute(POI_CARD_ATTR, '');
    const inside = document.createElement('img');
    card.appendChild(inside);
    document.body.appendChild(card);
    expect(isPoiCardGesture(card)).toBe(true);
    expect(isPoiCardGesture(inside)).toBe(true);
  });

  it('lets a gesture on the scene through, and does not trip on a missing target', () => {
    expect(isPoiCardGesture(document.createElement('canvas'))).toBe(false);
    expect(isPoiCardGesture(null)).toBe(false);
    expect(isPoiCardGesture(window)).toBe(false);
  });
});
