// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clampPipRect, defaultPipRect, PIP_MIN_WIDTH, renderPipPass, toGlRect } from './pipWindow';
import { registerSceneHelpers } from './sceneHelpers';

const ASPECT = 16 / 9;

describe('defaultPipRect — initial PiP position', () => {
  it('bottom-right corner, width 28 %, height according to the aspect ratio', () => {
    const r = defaultPipRect(1000, 600, ASPECT);
    expect(r.w).toBe(280);
    expect(r.h).toBe(Math.round(280 / ASPECT));
    expect(r.x).toBe(1000 - 280 - 10);
    expect(r.y).toBe(600 - r.h - 10);
  });

  it('stays inside a very small container', () => {
    const r = defaultPipRect(200, 100, ASPECT);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(200);
  });
});

describe('clampPipRect — window constraints', () => {
  it('clamps the width to the minimum readable size', () => {
    const r = clampPipRect({ x: 0, y: 0, w: 10, h: 5 }, 1000, 600, ASPECT);
    expect(r.w).toBe(PIP_MIN_WIDTH);
    expect(r.h).toBe(Math.round(PIP_MIN_WIDTH / ASPECT));
  });

  it('locks the height to the aspect ratio', () => {
    const r = clampPipRect({ x: 0, y: 0, w: 320, h: 999 }, 1000, 600, 2);
    expect(r.h).toBe(160);
  });

  it('reduces the width if the height overflows the container', () => {
    const r = clampPipRect({ x: 0, y: 0, w: 900, h: 0 }, 1000, 200, ASPECT);
    expect(r.h).toBeLessThanOrEqual(200);
  });

  it('brings the position back inside the container', () => {
    const r = clampPipRect({ x: 5000, y: -50, w: 300, h: 0 }, 1000, 600, ASPECT);
    expect(r.x).toBe(1000 - r.w);
    expect(r.y).toBe(0);
  });
});

describe('toGlRect — DOM → GL conversion', () => {
  it('flips the vertical axis (bottom-left origin)', () => {
    expect(toGlRect({ x: 20, y: 30, w: 200, h: 100 }, 600)).toEqual({
      x: 20,
      y: 600 - 30 - 100,
      w: 200,
      h: 100,
    });
  });
});

/** Minimal renderer: the PiP pass only needs these state settings (no WebGL). */
function fakeRenderer() {
  const calls: string[] = [];
  return {
    calls,
    autoClear: true,
    setScissorTest: (on: boolean) => calls.push(`scissorTest:${on}`),
    setScissor: () => calls.push('scissor'),
    setViewport: (x: number, y: number, w: number, h: number) => calls.push(`viewport:${x},${y},${w},${h}`),
    clearDepth: () => calls.push('clearDepth'),
    render: (): void => {
      calls.push('render');
    },
  };
}

describe('renderPipPass — the PiP pass', () => {
  const rect = { x: 10, y: 20, w: 320, h: 180 };

  it('takes near/far from the free camera (framing resets them, the PiP used to keep them)', () => {
    const renderer = fakeRenderer();
    const layoutCam = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    renderPipPass(renderer as unknown as THREE.WebGLRenderer, new THREE.Scene(), layoutCam, rect, 1000, 600, {
      near: 2,
      far: 40000,
    });
    expect(layoutCam.near).toBe(2);
    expect(layoutCam.far).toBe(40000);
    expect(layoutCam.aspect).toBeCloseTo(320 / 180);
    // Full-frame viewport restored: the next frame's main render depends on it.
    expect(renderer.calls.at(-1)).toBe('viewport:0,0,1000,600');
  });

  it('does not draw the rig helper objects (they were rigid there, hence motionless)', () => {
    const renderer = fakeRenderer();
    const helper = new THREE.Object3D();
    const off = registerSceneHelpers(helper);
    let visibleAtRender: boolean | null = null;
    renderer.render = (): void => {
      visibleAtRender = helper.visible;
      renderer.calls.push('render');
    };
    renderPipPass(
      renderer as unknown as THREE.WebGLRenderer,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      rect,
      1000,
      600,
    );
    expect(visibleAtRender).toBe(false);
    expect(helper.visible).toBe(true); // and rendered in the free view right after
    off();
  });

  it('degenerate rect or container: no pass', () => {
    const renderer = fakeRenderer();
    renderPipPass(
      renderer as unknown as THREE.WebGLRenderer,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      { x: 0, y: 0, w: 0, h: 180 },
      1000,
      600,
    );
    expect(renderer.calls).toHaveLength(0);
  });
});
