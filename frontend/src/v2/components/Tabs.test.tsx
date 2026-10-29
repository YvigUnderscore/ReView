// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import Tabs from './Tabs';

/**
 * The underline follows the active tab, without framer-motion.
 *
 * The layout animation (`layoutId`) made the bar slide from one tab to the next; it
 * cost 38.5 kB gzipped on first load (F3). The bar is now a single node,
 * positioned from a DOM measurement and moved by a CSS transition. What can break
 * silently is the measurement: the bar would stay stuck on the left, or disappear.
 * These cases check it in widths and offsets.
 */

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'shots', label: 'Shots' },
  { key: 'assets', label: 'Assets' },
];

/** Simulated width: happy-dom does no layout at all, so everything is zero there. */
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
  it('places the underline under the active tab', () => {
    stubLayout();
    const { container } = render(<Tabs tabs={TABS} active="overview" onChange={() => {}} />);
    const line = underlineOf(container);
    expect(line).not.toBeNull();
    // "Overview": 8 characters × 10, first in the bar.
    expect(line?.style.width).toBe('80px');
    expect(line?.style.transform).toBe('translateX(0px)');
    expect(line?.style.opacity).toBe('1');
  });

  it('moves it when the active tab changes', () => {
    stubLayout();
    const { container, rerender } = render(<Tabs tabs={TABS} active="overview" onChange={() => {}} />);
    rerender(<Tabs tabs={TABS} active="assets" onChange={() => {}} />);
    const line = underlineOf(container);
    // "Overview" (80) + gutter (4) + "Shots" (50) + gutter (4) = 138.
    expect(line?.style.transform).toBe('translateX(138px)');
    expect(line?.style.width).toBe('60px');
  });

  it('disappears if the active tab is not in the bar', () => {
    stubLayout();
    const { container } = render(<Tabs tabs={TABS} active="inconnu" onChange={() => {}} />);
    expect(underlineOf(container)?.style.opacity).toBe('0');
  });
});
