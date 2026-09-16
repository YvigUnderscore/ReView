// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import Tabs from './Tabs';

/**
 * Le soulignement suit l'onglet actif — sans framer-motion.
 *
 * L'animation de layout (`layoutId`) faisait glisser le trait d'un onglet à l'autre ; elle
 * coûtait 38,5 ko gzip de premier chargement (F3). Le trait est maintenant un nœud unique,
 * positionné depuis la mesure du DOM et déplacé par une transition CSS. Ce qui peut casser
 * silencieusement, c'est la mesure : le trait resterait collé à gauche, ou disparaîtrait.
 * Ces cas-là la vérifient en largeurs et en décalages.
 */

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'shots', label: 'Shots' },
  { key: 'assets', label: 'Assets' },
];

/** Largeur simulée : happy-dom ne fait aucune mise en page, tout y vaut zéro. */
const widthOf = (el: Element) => (el.textContent ?? '').length * 10;

function stubLayout() {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return widthOf(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get(this: HTMLElement) {
      let x = 0;
      for (let prev = this.previousElementSibling; prev; prev = prev.previousElementSibling) {
        x += widthOf(prev) + 4; // + la gouttière `gap-1`
      }
      return x;
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetLeft');
});

const underlineOf = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[role="tablist"] > span[aria-hidden]');

describe('Tabs', () => {
  it('place le trait sous l’onglet actif', () => {
    stubLayout();
    const { container } = render(<Tabs tabs={TABS} active="overview" onChange={() => {}} />);
    const line = underlineOf(container);
    expect(line).not.toBeNull();
    // « Overview » : 8 caractères × 10, premier de la barre.
    expect(line?.style.width).toBe('80px');
    expect(line?.style.transform).toBe('translateX(0px)');
    expect(line?.style.opacity).toBe('1');
  });

  it('le déplace quand l’onglet actif change', () => {
    stubLayout();
    const { container, rerender } = render(<Tabs tabs={TABS} active="overview" onChange={() => {}} />);
    rerender(<Tabs tabs={TABS} active="assets" onChange={() => {}} />);
    const line = underlineOf(container);
    // « Overview » (80) + gouttière (4) + « Shots » (50) + gouttière (4) = 138.
    expect(line?.style.transform).toBe('translateX(138px)');
    expect(line?.style.width).toBe('60px');
  });

  it('s’efface si l’onglet actif n’est pas dans la barre', () => {
    stubLayout();
    const { container } = render(<Tabs tabs={TABS} active="inconnu" onChange={() => {}} />);
    expect(underlineOf(container)?.style.opacity).toBe('0');
  });
});
