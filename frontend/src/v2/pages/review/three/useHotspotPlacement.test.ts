// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hotspot3D } from '../reviewTypes';
import type { Model3DThreeState } from './useModel3DThree';
import { useHotspotPlacement } from './useHotspotPlacement';

afterEach(cleanup);

const HOTSPOT: Hotspot3D = { position: '1 2 3', normal: '0 0 1', space: 'object' };

/** Viewer minimal : le hook n'utilise que le canvas, `ready` et le raycast au pointeur. */
function viewer(hit: Hotspot3D | null = HOTSPOT) {
  const dom = document.createElement('div');
  const hotspotAtPointer = vi.fn(() => hit);
  const model3d = {
    ready: true,
    getSceneHandle: () => ({ dom }),
    hotspotAtPointer,
  } as unknown as Model3DThreeState;
  return { dom, model3d, hotspotAtPointer };
}

const click = (dom: HTMLElement, from: [number, number], to = from) => {
  dom.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: from[0], clientY: from[1] }));
  dom.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: to[0], clientY: to[1] }));
};

describe('useHotspotPlacement', () => {
  it('ne pose rien tant que l’outil n’est pas armé', () => {
    const { dom, model3d, hotspotAtPointer } = viewer();
    const onPlace = vi.fn();
    renderHook(() => useHotspotPlacement(model3d, onPlace));
    act(() => click(dom, [40, 40]));
    expect(hotspotAtPointer).not.toHaveBeenCalled();
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('pose le point sous le pointeur au clic, puis se désarme', () => {
    const { dom, model3d, hotspotAtPointer } = viewer();
    const onPlace = vi.fn();
    const { result } = renderHook(() => useHotspotPlacement(model3d, onPlace));
    act(() => result.current.arm());
    expect(result.current.armed).toBe(true);
    expect(dom.style.cursor).toBe('crosshair');
    act(() => click(dom, [120, 80]));
    expect(hotspotAtPointer).toHaveBeenCalledWith(120, 80);
    expect(onPlace).toHaveBeenCalledWith(HOTSPOT);
    expect(result.current.armed).toBe(false);
    expect(dom.style.cursor).toBe('');
  });

  it('ignore un clic glissé (c’est une orbite) et un clic dans le vide', () => {
    const { dom, model3d } = viewer(null);
    const onPlace = vi.fn();
    const { result } = renderHook(() => useHotspotPlacement(model3d, onPlace));
    act(() => result.current.arm());
    act(() => click(dom, [10, 10], [80, 10])); // glissement
    act(() => click(dom, [10, 10])); // clic immobile, mais rien sous le rayon
    expect(onPlace).not.toHaveBeenCalled();
    // L'outil reste armé : on n'a pas encore désigné de défaut.
    expect(result.current.armed).toBe(true);
  });

  it('Échap désarme sans rien poser', () => {
    const { dom, model3d } = viewer();
    const onPlace = vi.fn();
    const { result } = renderHook(() => useHotspotPlacement(model3d, onPlace));
    act(() => result.current.arm());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.armed).toBe(false);
    act(() => click(dom, [10, 10]));
    expect(onPlace).not.toHaveBeenCalled();
  });
});
