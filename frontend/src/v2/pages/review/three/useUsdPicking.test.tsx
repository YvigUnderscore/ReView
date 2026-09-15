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
  renderHook(() =>
    useUsdPicking(
      () => handle as never,
      true,
      onSelect,
      () => '/Kitchen_set/Props_grp/Chair',
    ),
  );
  return { dom, onSelect };
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
    expect(onSelect).toHaveBeenCalledWith('/Kitchen_set/Props_grp/Chair', { additive: false });
  });

  it('sélectionne encore quand les contrôles de caméra coupent la propagation', () => {
    // C'est LE cas qui cassait : écouteurs en bulle, `pointerdown` gauche jamais reçu.
    const { dom, onSelect } = setup({ swallowLeftPointerDown: true });
    click(dom);
    expect(onSelect).toHaveBeenCalledWith('/Kitchen_set/Props_grp/Chair', { additive: false });
  });

  it('ne sélectionne pas quand le pointeur a glissé — c’est une orbite, pas un clic', () => {
    const { dom, onSelect } = setup({ swallowLeftPointerDown: true });
    dom.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 50, clientY: 50, button: 0, bubbles: true }),
    );
    dom.dispatchEvent(new PointerEvent('pointerup', { clientX: 90, clientY: 50, button: 0, bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ajoute à la sélection avec Ctrl', () => {
    const { dom, onSelect } = setup({ swallowLeftPointerDown: true });
    const at = { clientX: 50, clientY: 50, button: 0, bubbles: true, ctrlKey: true };
    dom.dispatchEvent(new PointerEvent('pointerdown', at));
    dom.dispatchEvent(new PointerEvent('pointerup', at));
    expect(onSelect).toHaveBeenCalledWith('/Kitchen_set/Props_grp/Chair', { additive: true });
  });
});
