// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sélection d'un prim au clic — et la raison pour laquelle elle ne marchait pas.
 *
 * Les contrôles de caméra vivent sur le même élément et traitent le bouton GAUCHE (orbite).
 * Leur `pointerdown` arrêtait la propagation avant que le module de picking n'enregistre
 * l'origine du geste : `down` restait nul, `pointerup` sortait aussitôt, et un clic gauche ne
 * sélectionnait jamais rien. Le clic DROIT, lui, traversait — ces contrôles le traitent
 * autrement (vol libre) — d'où l'asymétrie observée au navigateur : le menu du prim s'ouvrait
 * et « Cadrer » visait le bon objet, mais rien ne se surlignait.
 *
 * Ces tests reproduisent le concurrent qui coupe la propagation. Ils échouent si les écouteurs
 * repassent en phase de bulle.
 *
 * S'y ajoute la **granularité** du clic : le hook demande au résolveur du viewer la résolution
 * promue (le component englobant) et, Alt enfoncé, la résolution exacte — la feuille touchée.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUsdPicking } from './useUsdPicking';

/** Le strict nécessaire de Three : un rayon qui touche toujours un objet visible. */
const HIT = { name: 'mesh', visible: true, parent: null };
const THREE = {
  Vector2: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
  Raycaster: class {
    setFromCamera() {}
    intersectObject() {
      return [{ object: HIT }];
    }
  },
} as unknown as typeof import('three');

/** Le prim que le rayon touche, et le component qui le porte. */
const CHAIR = '/Kitchen_set/Props_grp/ChairB_1';
const LEAF = '/Kitchen_set/Props_grp/ChairB_1/Geom/seat';

function setup(options: { swallowLeftPointerDown: boolean }) {
  const dom = document.createElement('div');
  document.body.appendChild(dom);
  dom.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;

  // Le concurrent : posé en BULLE sur le même élément, comme les contrôles de caméra, et
  // qui coupe net la chaîne pour le bouton qu'il traite (l'orbite, donc le gauche).
  // `stopImmediatePropagation` — et non `stopPropagation` — est ce qui écarte les autres
  // écouteurs du MÊME élément ; seule la phase de capture y échappe.
  if (options.swallowLeftPointerDown) {
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 0) e.stopImmediatePropagation();
    });
    dom.addEventListener('pointerup', (e) => {
      if (e.button === 0) e.stopImmediatePropagation();
    });
  }

  const handle = { dom, THREE, camera: {}, modelObject: { name: 'root' } };
  const onSelect = vi.fn();
  // Le résolveur du viewer (`resolvePick`) : la feuille touchée, promue au component englobant,
  // sauf si l'appelant demande la résolution exacte (Alt+clic).
  const resolve = vi.fn((_object: unknown, opts?: { exact?: boolean }) => (opts?.exact ? LEAF : CHAIR));
  renderHook(() => useUsdPicking(() => handle as never, true, onSelect, resolve as never));
  return { dom, onSelect, resolve };
}

/** Un clic complet, immobile, au même point. */
function click(dom: HTMLElement, button = 0) {
  const at = { clientX: 50, clientY: 50, button, bubbles: true, cancelable: true };
  dom.dispatchEvent(new PointerEvent('pointerdown', at));
  dom.dispatchEvent(new PointerEvent('pointerup', at));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('useUsdPicking', () => {
  it('sélectionne le prim visé par un clic gauche', () => {
    const { dom, onSelect } = setup({ swallowLeftPointerDown: false });
    click(dom);
    expect(onSelect).toHaveBeenCalledWith(CHAIR, { additive: false });
  });

  it('sélectionne encore quand les contrôles de caméra coupent la propagation', () => {
    // C'est LE cas qui cassait : écouteurs en bulle, `pointerdown` gauche jamais reçu.
    const { dom, onSelect } = setup({ swallowLeftPointerDown: true });
    click(dom);
    expect(onSelect).toHaveBeenCalledWith(CHAIR, { additive: false });
  });

  it('ne sélectionne pas quand le pointeur a glissé — c’est une orbite, pas un clic', () => {
    const { dom, onSelect } = setup({ swallowLeftPointerDown: true });
    dom.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 50, clientY: 50, button: 0, bubbles: true }),
    );
    dom.dispatchEvent(new PointerEvent('pointerup', { clientX: 90, clientY: 50, button: 0, bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('descend à la feuille exacte avec Alt — la pièce, pas l’objet entier', () => {
    const { dom, onSelect, resolve } = setup({ swallowLeftPointerDown: true });
    const at = { clientX: 50, clientY: 50, button: 0, bubbles: true, altKey: true };
    dom.dispatchEvent(new PointerEvent('pointerdown', at));
    dom.dispatchEvent(new PointerEvent('pointerup', at));
    expect(resolve).toHaveBeenCalledWith(expect.anything(), { exact: true });
    expect(onSelect).toHaveBeenCalledWith(LEAF, { additive: false });
  });

  it('demande la résolution promue quand Alt n’est pas enfoncé', () => {
    const { dom, resolve } = setup({ swallowLeftPointerDown: true });
    click(dom);
    expect(resolve).toHaveBeenCalledWith(expect.anything(), { exact: false });
  });

  it('ajoute à la sélection avec Ctrl', () => {
    const { dom, onSelect } = setup({ swallowLeftPointerDown: true });
    const at = { clientX: 50, clientY: 50, button: 0, bubbles: true, ctrlKey: true };
    dom.dispatchEvent(new PointerEvent('pointerdown', at));
    dom.dispatchEvent(new PointerEvent('pointerup', at));
    expect(onSelect).toHaveBeenCalledWith(CHAIR, { additive: true });
  });
});
