// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clampPipRect, defaultPipRect, PIP_MIN_WIDTH, renderPipPass, toGlRect } from './pipWindow';
import { registerSceneHelpers } from './sceneHelpers';

const ASPECT = 16 / 9;

describe('defaultPipRect — position initiale du PiP', () => {
  it('coin bas-droit, largeur 28 %, hauteur selon l’aspect', () => {
    const r = defaultPipRect(1000, 600, ASPECT);
    expect(r.w).toBe(280);
    expect(r.h).toBe(Math.round(280 / ASPECT));
    expect(r.x).toBe(1000 - 280 - 10);
    expect(r.y).toBe(600 - r.h - 10);
  });

  it('reste dans un conteneur très petit', () => {
    const r = defaultPipRect(200, 100, ASPECT);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(200);
  });
});

describe('clampPipRect — contraintes de la fenêtre', () => {
  it('borne la largeur au minimum lisible', () => {
    const r = clampPipRect({ x: 0, y: 0, w: 10, h: 5 }, 1000, 600, ASPECT);
    expect(r.w).toBe(PIP_MIN_WIDTH);
    expect(r.h).toBe(Math.round(PIP_MIN_WIDTH / ASPECT));
  });

  it('asservit la hauteur à l’aspect', () => {
    const r = clampPipRect({ x: 0, y: 0, w: 320, h: 999 }, 1000, 600, 2);
    expect(r.h).toBe(160);
  });

  it('réduit la largeur si la hauteur déborde du conteneur', () => {
    const r = clampPipRect({ x: 0, y: 0, w: 900, h: 0 }, 1000, 200, ASPECT);
    expect(r.h).toBeLessThanOrEqual(200);
  });

  it('ramène la position dans le conteneur', () => {
    const r = clampPipRect({ x: 5000, y: -50, w: 300, h: 0 }, 1000, 600, ASPECT);
    expect(r.x).toBe(1000 - r.w);
    expect(r.y).toBe(0);
  });
});

describe('toGlRect — conversion DOM → GL', () => {
  it('inverse l’axe vertical (origine bas-gauche)', () => {
    expect(toGlRect({ x: 20, y: 30, w: 200, h: 100 }, 600)).toEqual({
      x: 20,
      y: 600 - 30 - 100,
      w: 200,
      h: 100,
    });
  });
});

/** Renderer minimal : la passe PiP n'a besoin que de ces réglages d'état (aucun WebGL). */
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

describe('renderPipPass — la passe du PiP', () => {
  const rect = { x: 10, y: 20, w: 320, h: 180 };

  it('reprend near/far de la caméra libre (le cadrage les recale, le PiP les gardait)', () => {
    const renderer = fakeRenderer();
    const layoutCam = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    renderPipPass(renderer as unknown as THREE.WebGLRenderer, new THREE.Scene(), layoutCam, rect, 1000, 600, {
      near: 2,
      far: 40000,
    });
    expect(layoutCam.near).toBe(2);
    expect(layoutCam.far).toBe(40000);
    expect(layoutCam.aspect).toBeCloseTo(320 / 180);
    // Viewport plein cadre restauré : le rendu principal de la frame suivante en dépend.
    expect(renderer.calls.at(-1)).toBe('viewport:0,0,1000,600');
  });

  it('ne dessine pas les objets d’aide du rig (ils y étaient rigides, donc immobiles)', () => {
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
    expect(helper.visible).toBe(true); // et rendu à la vue libre juste après
    off();
  });

  it('rect ou conteneur dégénéré : aucune passe', () => {
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
