// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Right-button sharing on spatial viewers: short → menu, held/dragged → flight.
 *
 * The Radix menu wraps the pane, so the hook re-dispatches a **new** `contextmenu` on the canvas's
 * parent. That is what these tests observe: neither the menu opening (Radix is not mounted) nor
 * pixels — the re-dispatched event, or its absence.
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
  // The competitor: the camera controls live on the same element and cut the chain for the
  // button they handle. Only the capture phase gets past it.
  dom.addEventListener('pointerdown', (e) => e.stopImmediatePropagation());
  const opened = vi.fn();
  parent.addEventListener('contextmenu', opened);
  const prepareSpy = vi.fn(prepare);
  renderHook(() => useSpatialContextMenu(() => dom, true, prepareSpy));
  return { dom, parent, opened, prepare: prepareSpy };
}

/** Right button press then release, with controlled displacement and duration. */
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
  it('opens the menu on a short right click, despite stopped propagation', () => {
    const { dom, opened, prepare } = setup();
    rightClick(dom);
    expect(prepare).toHaveBeenCalledWith({ clientX: 50, clientY: 50, altKey: false });
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('opens nothing when the pointer dragged — it was a flight', () => {
    const { dom, opened, prepare } = setup();
    rightClick(dom, { dx: 40 });
    expect(prepare).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  });

  it('opens nothing when the button stayed down — still flight, keyboard pending', () => {
    const { dom, opened } = setup();
    rightClick(dom, { heldMs: CONTEXT_TAP_MAX_MS + 50 });
    expect(opened).not.toHaveBeenCalled();
  });

  it('respects the viewer refusal — 3D does not serve a menu in empty space', () => {
    const { dom, opened, prepare } = setup(() => false);
    rightClick(dom);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
  });

  it('stops the native `contextmenu` of the canvas: the menu only opens on the measured gesture', () => {
    const { dom, opened } = setup();
    dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(opened).not.toHaveBeenCalled();
  });

  it('ignores the left button — it belongs to the orbit and the selection', () => {
    const { dom, opened } = setup();
    const at = { button: 0, clientX: 50, clientY: 50, bubbles: true };
    dom.dispatchEvent(new PointerEvent('pointerdown', at));
    dom.dispatchEvent(new PointerEvent('pointerup', at));
    expect(opened).not.toHaveBeenCalled();
  });
});
