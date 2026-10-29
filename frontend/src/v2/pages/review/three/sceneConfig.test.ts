// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { configureRenderer, resizeRendererCamera, fitDistance, FRAME_MARGIN } from './sceneConfig';

describe('sceneConfig — Three base (V0)', () => {
  it('configureRenderer: ColorManagement + sRGB output + ACES Filmic', () => {
    const three = {
      ColorManagement: { enabled: false },
      SRGBColorSpace: 'srgb',
      ACESFilmicToneMapping: 42,
    } as unknown as typeof import('three');
    const renderer = { outputColorSpace: '', toneMapping: 0, toneMappingExposure: 0 };
    configureRenderer(three, renderer as never);
    expect(three.ColorManagement.enabled).toBe(true);
    expect(renderer.outputColorSpace).toBe('srgb');
    expect(renderer.toneMapping).toBe(42);
    expect(renderer.toneMappingExposure).toBe(1);
  });

  it('resizeRendererCamera: applies size + aspect, no-op if a dimension is zero', () => {
    const setSize = vi.fn();
    const updateProjectionMatrix = vi.fn();
    const camera = { aspect: 0, updateProjectionMatrix } as never;
    expect(resizeRendererCamera({ setSize }, camera, 1600, 900)).toBe(true);
    expect(setSize).toHaveBeenCalledWith(1600, 900, false);
    expect((camera as { aspect: number }).aspect).toBeCloseTo(1600 / 900);
    expect(updateProjectionMatrix).toHaveBeenCalledOnce();
    expect(resizeRendererCamera({ setSize }, camera, 0, 900)).toBe(false);
  });

  it('resizeRendererCamera + frameAspect: locks the frame aspect and extends the view (Phase 25)', () => {
    const setSize = vi.fn();
    const setViewOffset = vi.fn();
    const updateProjectionMatrix = vi.fn();
    const camera = { aspect: 0, setViewOffset, updateProjectionMatrix } as never;
    // 2000×900 container (wider than 16/9): full view = 1600×900, x offset = -200.
    expect(resizeRendererCamera({ setSize }, camera, 2000, 900, 16 / 9)).toBe(true);
    expect((camera as { aspect: number }).aspect).toBeCloseTo(16 / 9);
    const [fw, fh, x, y, w, h] = setViewOffset.mock.calls[0] as number[];
    expect(fw).toBeCloseTo(1600);
    expect(fh).toBe(900);
    expect(x).toBeCloseTo(-200);
    expect(y).toBe(0);
    expect(w).toBe(2000);
    expect(h).toBe(900);
  });

  it('resizeRendererCamera without frameAspect: clears a residual viewOffset', () => {
    const setSize = vi.fn();
    const clearViewOffset = vi.fn();
    const camera = {
      aspect: 0,
      view: { enabled: true },
      clearViewOffset,
      updateProjectionMatrix: vi.fn(),
    } as never;
    resizeRendererCamera({ setSize }, camera, 800, 600);
    expect(clearViewOffset).toHaveBeenCalledOnce();
  });

  it('fitDistance: grows with the radius, constrained by the smallest FOV, 0 if degenerate', () => {
    const d = fitDistance(1, 45, 16 / 9);
    expect(d).toBeGreaterThan(0);
    // Doubled radius → doubled distance (linear).
    expect(fitDistance(2, 45, 16 / 9)).toBeCloseTo(d * 2);
    // Aspect < 1 (portrait): the horizontal FOV is the constraint → larger distance than in landscape.
    expect(fitDistance(1, 45, 0.5)).toBeGreaterThan(d);
    expect(fitDistance(0, 45, 1)).toBe(0);
    expect(fitDistance(1, 0, 1)).toBe(0);
  });

  it('applies the framing margin', () => {
    // At aspect 1, vFov = hFov: distance = radius / sin(vFov/2) * margin.
    const vFov = (45 * Math.PI) / 180;
    expect(fitDistance(1, 45, 1)).toBeCloseTo((1 / Math.sin(vFov / 2)) * FRAME_MARGIN);
  });
});
