// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCameraAutoKey } from './useCameraAutoKey';
import { suspendAutoKey } from './autoKeyGate';

/**
 * L'auto-key écoute le canvas, où l'on trouve aussi bien la caméra libre que le gizmo de la
 * caméra-objet. Hors caméra, le `pointerup` d'un drag de gizmo posait une clé de 8 canaux prise
 * sur la caméra **libre**, par-dessus celle que le gizmo venait d'écrire.
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

/** Rejoue un drag sur le canvas, du point `from` au point `to` (px). */
function drag(from: [number, number], to: [number, number]) {
  dom.dispatchEvent(new PointerEvent('pointerdown', { clientX: from[0], clientY: from[1] }));
  dom.dispatchEvent(new PointerEvent('pointermove', { clientX: to[0], clientY: to[1] }));
  dom.dispatchEvent(new PointerEvent('pointerup', { clientX: to[0], clientY: to[1] }));
}

describe('useCameraAutoKey', () => {
  it('pose une clé après un geste caméra franc', () => {
    const insert = vi.fn();
    renderHook(() => useCameraAutoKey(true, getDom, insert));
    drag([10, 10], [60, 10]);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('ignore un clic net (moins de 3 px)', () => {
    const insert = vi.fn();
    renderHook(() => useCameraAutoKey(true, getDom, insert));
    drag([10, 10], [11, 11]);
    expect(insert).not.toHaveBeenCalled();
  });

  it('ne pose rien quand il est éteint', () => {
    const insert = vi.fn();
    renderHook(() => useCameraAutoKey(false, getDom, insert));
    drag([10, 10], [60, 10]);
    expect(insert).not.toHaveBeenCalled();
  });

  it('ne pose rien tant que le portier le suspend (hors caméra)', () => {
    const insert = vi.fn();
    renderHook(() => useCameraAutoKey(true, getDom, insert));
    suspendAutoKey(true);
    drag([10, 10], [60, 10]);
    expect(insert).not.toHaveBeenCalled();
  });

  it('reprend dès que le portier relâche, sans remonter l’écoute', () => {
    const insert = vi.fn();
    renderHook(() => useCameraAutoKey(true, getDom, insert));
    suspendAutoKey(true);
    drag([10, 10], [60, 10]);
    suspendAutoKey(false);
    drag([10, 10], [60, 10]);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('débounce la molette, et la suspend aussi', () => {
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
