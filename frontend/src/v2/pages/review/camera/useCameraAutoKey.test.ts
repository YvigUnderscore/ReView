// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCameraAutoKey } from './useCameraAutoKey';
import { suspendAutoKey } from './autoKeyGate';

/**
 * Auto-key listens to the canvas, where both the free camera and the camera-object gizmo are found.
 * Outside camera, the `pointerup` of a gizmo drag set an 8-channel key taken from the **free**
 * camera, on top of the one the gizmo had just written.
 */

let dom: HTMLDivElement;
const getDom = () => dom;

beforeEach(() => {
  dom = document.createElement('div');
  document.body.appendChild(dom);
  suspendAutoKey(false);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  dom.remove();
});

/** Replays a drag on the canvas, from point `from` to point `to` (px). */
function drag(from: [number, number], to: [number, number]) {
  dom.dispatchEvent(new PointerEvent('pointerdown', { clientX: from[0], clientY: from[1] }));
  dom.dispatchEvent(new PointerEvent('pointermove', { clientX: to[0], clientY: to[1] }));
  dom.dispatchEvent(new PointerEvent('pointerup', { clientX: to[0], clientY: to[1] }));
}

describe('useCameraAutoKey', () => {
  it('sets a key after a decisive camera gesture', () => {
    const insert = vi.fn();
    renderHook(() => useCameraAutoKey(true, getDom, insert));
    drag([10, 10], [60, 10]);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('ignores a clean click (under 3 px)', () => {
    const insert = vi.fn();
    renderHook(() => useCameraAutoKey(true, getDom, insert));
    drag([10, 10], [11, 11]);
    expect(insert).not.toHaveBeenCalled();
  });

  it('sets nothing when it is off', () => {
    const insert = vi.fn();
    renderHook(() => useCameraAutoKey(false, getDom, insert));
    drag([10, 10], [60, 10]);
    expect(insert).not.toHaveBeenCalled();
  });

  it('sets nothing while the gate suspends it (outside camera)', () => {
    const insert = vi.fn();
    renderHook(() => useCameraAutoKey(true, getDom, insert));
    suspendAutoKey(true);
    drag([10, 10], [60, 10]);
    expect(insert).not.toHaveBeenCalled();
  });

  it('resumes as soon as the gate releases, without remounting the listener', () => {
    const insert = vi.fn();
    renderHook(() => useCameraAutoKey(true, getDom, insert));
    suspendAutoKey(true);
    drag([10, 10], [60, 10]);
    suspendAutoKey(false);
    drag([10, 10], [60, 10]);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('debounces the wheel, and suspends it too', () => {
    const insert = vi.fn();
    renderHook(() => useCameraAutoKey(true, getDom, insert));
    dom.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
    vi.advanceTimersByTime(300);
    expect(insert).toHaveBeenCalledTimes(1);
    suspendAutoKey(true);
    dom.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
    vi.advanceTimersByTime(300);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
