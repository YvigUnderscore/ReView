// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFitBox } from './useFitBox';

/** Container with a fixed size: happy-dom does no layout at all. */
const container = (w: number, h: number) => {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: h, configurable: true });
  return { current: el };
};

describe('useFitBox', () => {
  it('with no known ratio, no box: the media is not loaded yet', () => {
    const ref = container(800, 600);
    const { result } = renderHook(() => useFitBox(ref));
    expect(result.current.box).toBeNull();
  });

  it('container wider than the media: the height drives', () => {
    const ref = container(800, 300);
    const { result } = renderHook(() => useFitBox(ref));
    act(() => result.current.setAspect(16 / 9));
    expect(result.current.box?.h).toBe(300);
    expect(result.current.box?.w).toBeCloseTo((300 * 16) / 9, 6);
  });

  it('container taller than the media: the width drives', () => {
    const ref = container(320, 600);
    const { result } = renderHook(() => useFitBox(ref));
    act(() => result.current.setAspect(16 / 9));
    expect(result.current.box).toEqual({ w: 320, h: 320 / (16 / 9) });
  });

  it('re-measures when the key changes (entering/leaving fullscreen)', () => {
    const ref = container(800, 300);
    const { result, rerender } = renderHook(({ full }: { full: boolean }) => useFitBox(ref, full), {
      initialProps: { full: false },
    });
    act(() => result.current.setAspect(2));
    expect(result.current.box).toEqual({ w: 600, h: 300 });
    Object.defineProperty(ref.current, 'clientHeight', { value: 100, configurable: true });
    rerender({ full: true });
    expect(result.current.box).toEqual({ w: 200, h: 100 });
  });
});
