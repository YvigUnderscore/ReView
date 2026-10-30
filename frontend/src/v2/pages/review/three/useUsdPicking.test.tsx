// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Selecting a prim on click — and why it did not work.
 *
 * The camera controls live on the same element and handle the LEFT button (orbit). Their
 * `pointerdown` stopped propagation before the picking module recorded the origin of the gesture:
 * `down` stayed null, `pointerup` exited immediately, and a left click never selected anything.
 * The RIGHT click, however, got through — these controls handle it differently (free flight) —
 * hence the asymmetry seen in the browser: the prim menu opened and "Frame" targeted the right
 * object, but nothing got highlighted.
 *
 * These tests reproduce the competitor that stops propagation. They fail if the listeners go back
 * to the bubble phase.
 *
 * Added to this is the **granularity** of the click: the hook asks the viewer's resolver for the
 * promoted resolution (the enclosing component) and, with Alt held, for the exact resolution — the
 * leaf that was hit.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUsdPicking } from './useUsdPicking';

/** Just the bare minimum of Three: a ray that always hits a visible object. */
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

/** The prim the ray hits, and the component carrying it. */
const CHAIR = '/Kitchen_set/Props_grp/ChairB_1';
const LEAF = '/Kitchen_set/Props_grp/ChairB_1/Geom/seat';

function setup(options: { swallowLeftPointerDown: boolean }) {
  const dom = document.createElement('div');
  document.body.appendChild(dom);
  dom.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;

  // The competitor: placed in the BUBBLE phase on the same element, like the camera controls, and
  // cutting the chain for the button it handles (the orbit, therefore the left one).
  // `stopImmediatePropagation` — and not `stopPropagation` — is what bypasses the other listeners
  // of the SAME element; only the capture phase escapes it.
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
  // The viewer's resolver (`resolvePick`): the hit leaf, promoted to the enclosing component,
  // unless the caller asks for the exact resolution (Alt+click).
  const resolve = vi.fn((_object: unknown, opts?: { exact?: boolean }) => (opts?.exact ? LEAF : CHAIR));
  renderHook(() => useUsdPicking(() => handle as never, true, onSelect, resolve as never));
  return { dom, onSelect, resolve };
}

/** A complete click, motionless, at the same point. */
function click(dom: HTMLElement, button = 0) {
  const at = { clientX: 50, clientY: 50, button, bubbles: true, cancelable: true };
  dom.dispatchEvent(new PointerEvent('pointerdown', at));
  dom.dispatchEvent(new PointerEvent('pointerup', at));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('useUsdPicking', () => {
  it('selects the prim targeted by a left click', () => {
    const { dom, onSelect } = setup({ swallowLeftPointerDown: false });
    click(dom);
    expect(onSelect).toHaveBeenCalledWith(CHAIR, { additive: false });
  });

  it('still selects when the camera controls stop propagation', () => {
    // This IS the case that was broken: bubble listeners, left `pointerdown` never received.
    const { dom, onSelect } = setup({ swallowLeftPointerDown: true });
    click(dom);
    expect(onSelect).toHaveBeenCalledWith(CHAIR, { additive: false });
  });

  it('does not select when the pointer slid — it is an orbit, not a click', () => {
    const { dom, onSelect } = setup({ swallowLeftPointerDown: true });
    dom.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 50, clientY: 50, button: 0, bubbles: true }),
    );
    dom.dispatchEvent(new PointerEvent('pointerup', { clientX: 90, clientY: 50, button: 0, bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('descends to the exact leaf with Alt — the part, not the whole object', () => {
    const { dom, onSelect, resolve } = setup({ swallowLeftPointerDown: true });
    const at = { clientX: 50, clientY: 50, button: 0, bubbles: true, altKey: true };
    dom.dispatchEvent(new PointerEvent('pointerdown', at));
    dom.dispatchEvent(new PointerEvent('pointerup', at));
    expect(resolve).toHaveBeenCalledWith(expect.anything(), { exact: true });
    expect(onSelect).toHaveBeenCalledWith(LEAF, { additive: false });
  });

  it('requests the promoted resolution when Alt is not held', () => {
    const { dom, resolve } = setup({ swallowLeftPointerDown: true });
    click(dom);
    expect(resolve).toHaveBeenCalledWith(expect.anything(), { exact: false });
  });

  it('adds to the selection with Ctrl', () => {
    const { dom, onSelect } = setup({ swallowLeftPointerDown: true });
    const at = { clientX: 50, clientY: 50, button: 0, bubbles: true, ctrlKey: true };
    dom.dispatchEvent(new PointerEvent('pointerdown', at));
    dom.dispatchEvent(new PointerEvent('pointerup', at));
    expect(onSelect).toHaveBeenCalledWith(CHAIR, { additive: true });
  });
});
