// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Le partage du bouton droit des viewers spatiaux : bref → menu, maintenu/glissé → vol.
 *
 * Le menu Radix enveloppe le pane, donc le hook relance un `contextmenu` **neuf** sur le parent
 * du canvas. C'est ce que ces tests observent : ni l'ouverture du menu (Radix n'est pas monté),
 * ni des pixels — l'événement relancé, ou son absence.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { CONTEXT_TAP_MAX_MS } from './contextGesture';
import { useSpatialContextMenu } from './useSpatialContextMenu';

function setup(prepare: () => boolean = () => true) {
  const parent = document.createElement('div');
  const dom = document.createElement('div');
  parent.appendChild(dom);
  document.body.appendChild(parent);
  // Le concurrent : les contrôles de caméra vivent sur le même élément et coupent la chaîne
  // pour le bouton qu'ils traitent. Seule la phase de capture y échappe.
  dom.addEventListener('pointerdown', (e) => e.stopImmediatePropagation());
  const opened = vi.fn();
  parent.addEventListener('contextmenu', opened);
  const prepareSpy = vi.fn(prepare);
  renderHook(() => useSpatialContextMenu(() => dom, true, prepareSpy));
  return { dom, parent, opened, prepare: prepareSpy };
}

/** Appui puis relâchement du bouton droit, avec déplacement et durée maîtrisés. */
function rightClick(dom: HTMLElement, opts: { dx?: number; heldMs?: number } = {}) {
  const { dx = 0, heldMs = 0 } = opts;
  const down = new PointerEvent('pointerdown', { button: 2, clientX: 50, clientY: 50, bubbles: true });
  Object.defineProperty(down, 'timeStamp', { value: 1000 });
  const up = new PointerEvent('pointerup', { button: 2, clientX: 50 + dx, clientY: 50, bubbles: true });
  Object.defineProperty(up, 'timeStamp', { value: 1000 + heldMs });
  dom.dispatchEvent(down);
  dom.dispatchEvent(up);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('useSpatialContextMenu', () => {
  it('ouvre le menu sur un clic droit bref, malgré la propagation coupée', () => {
    const { dom, opened, prepare } = setup();
    rightClick(dom);
    expect(prepare).toHaveBeenCalledWith({ clientX: 50, clientY: 50, altKey: false });
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('n’ouvre rien quand le pointeur a glissé — c’était un vol', () => {
    const { dom, opened, prepare } = setup();
    rightClick(dom, { dx: 40 });
    expect(prepare).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  });

  it('n’ouvre rien quand le bouton est resté enfoncé — vol immobile, clavier en attente', () => {
    const { dom, opened } = setup();
    rightClick(dom, { heldMs: CONTEXT_TAP_MAX_MS + 50 });
    expect(opened).not.toHaveBeenCalled();
  });

  it('respecte le refus du viewer — le 3D ne sert pas de menu dans le vide', () => {
    const { dom, opened, prepare } = setup(() => false);
    rightClick(dom);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
  });

  it('arrête le `contextmenu` natif du canvas : le menu ne s’ouvre que sur le geste mesuré', () => {
    const { dom, opened } = setup();
    dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(opened).not.toHaveBeenCalled();
  });

  it('ignore le bouton gauche — il appartient à l’orbite et à la sélection', () => {
    const { dom, opened } = setup();
    const at = { button: 0, clientX: 50, clientY: 50, bubbles: true };
    dom.dispatchEvent(new PointerEvent('pointerdown', at));
    dom.dispatchEvent(new PointerEvent('pointerup', at));
    expect(opened).not.toHaveBeenCalled();
  });
});
