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

/** Conteneur de viewer, avec les pastilles que le marqueur y pose (posées ici à la main). */
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

describe('poiAnchors — les pastilles se lisent par leur rang, pas par l’ordre du DOM', () => {
  it('range les pastilles par rang : l’index de la liste EST le rang du point', () => {
    const container = viewerWith(2, 0, 1);
    expect(poiAnchors(container).map((el) => el.getAttribute(POI_ANCHOR_ATTR))).toEqual(['0', '1', '2']);
  });

  it('sans conteneur, la liste est vide — le calque peut se monter avant le viewer', () => {
    expect(poiAnchors(null)).toEqual([]);
  });
});

describe('subscribePoiAnchors — le calque se monte avant comme après les pastilles', () => {
  it('joue le rappel tout de suite avec les pastilles déjà posées', () => {
    const container = viewerWith(0, 1);
    const seen = vi.fn();
    subscribePoiAnchors(container, seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0]).toHaveLength(2);
  });

  it('le rejoue à chaque annonce du marqueur — une pastille de plus est vue', () => {
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

  it('se désabonne : le calque démonté ne reçoit plus rien', () => {
    const container = viewerWith(0);
    const seen = vi.fn();
    subscribePoiAnchors(container, seen)();
    announcePoiAnchors(container);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('sans conteneur, le désabonnement reste appelable', () => {
    const seen = vi.fn();
    expect(() => subscribePoiAnchors(null, seen)()).not.toThrow();
    expect(seen).toHaveBeenCalledWith([]);
  });
});

describe('sameAnchors — un calque ne se réabonne pas pour une liste identique', () => {
  it('compare nœud pour nœud, dans l’ordre', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    expect(sameAnchors([a, b], [a, b])).toBe(true);
    expect(sameAnchors([a, b], [b, a])).toBe(false);
    expect(sameAnchors([a], [a, b])).toBe(false);
  });
});

describe('isPoiCardGesture — lire un commentaire ancré n’est pas naviguer', () => {
  it('reconnaît un geste parti de la carte, ou de n’importe quoi dedans', () => {
    const card = document.createElement('div');
    card.setAttribute(POI_CARD_ATTR, '');
    const inside = document.createElement('img');
    card.appendChild(inside);
    document.body.appendChild(card);
    expect(isPoiCardGesture(card)).toBe(true);
    expect(isPoiCardGesture(inside)).toBe(true);
  });

  it('laisse passer un geste sur la scène — et ne trébuche pas sur une cible absente', () => {
    expect(isPoiCardGesture(document.createElement('canvas'))).toBe(false);
    expect(isPoiCardGesture(null)).toBe(false);
    expect(isPoiCardGesture(window)).toBe(false);
  });
});
