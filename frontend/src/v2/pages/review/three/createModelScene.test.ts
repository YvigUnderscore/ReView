// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as REAL from 'three';
import { createModelScene, disposeSceneTree, type ModelSceneModules } from './createModelScene';

/**
 * Freeing the GPU resources of the model (F9). The quantity measured is the **number of WebGL
 * objects freed**: Three signals each release with a `dispose` event (the event that `WebGLRenderer`
 * listens to in order to clear buffers and textures), so we count it directly. `WebGLRenderer` is
 * replaced by a double: no WebGL context is required, but the scene, the materials and the textures
 * are the real Three objects.
 */

class FakeRenderer {
  domElement = document.createElement('canvas');
  outputColorSpace = '';
  toneMapping = 0;
  toneMappingExposure = 0;
  disposed = 0;
  contextLost = 0;
  setPixelRatio() {}
  setSize() {}
  render() {}
  dispose() {
    this.disposed += 1;
  }
  forceContextLoss() {
    this.contextLost += 1;
  }
}

class FakeControls {
  enableDamping = false;
  dampingFactor = 0;
  target = new REAL.Vector3();
  disposed = 0;
  dispose() {
    this.disposed += 1;
  }
  update() {}
  addEventListener() {}
  removeEventListener() {}
}

function makeScene() {
  const modules = {
    THREE: { ...REAL, WebGLRenderer: FakeRenderer },
    OrbitControls: FakeControls,
  } as unknown as ModelSceneModules;
  const container = document.createElement('div');
  const scene = createModelScene(modules, container);
  return { scene, container, renderer: scene.renderer as unknown as FakeRenderer };
}

/**
 * Counts the releases of a list of Three objects (geometry, material or texture).
 *
 * The three classes do emit a `dispose` event, but each types `addEventListener` with ITS OWN literal
 * union of event names: no common structural signature accepts all of them. We therefore take them
 * by their real type and attach the listener behind a single conversion point, rather than widening
 * each caller's type.
 */
type Disposable = REAL.BufferGeometry | REAL.Material | REAL.Texture;

function countDisposals(objects: Disposable[]) {
  const seen = new Map<number, number>();
  objects.forEach((o, i) =>
    (o as { addEventListener: (t: 'dispose', cb: () => void) => void }).addEventListener('dispose', () =>
      seen.set(i, (seen.get(i) ?? 0) + 1),
    ),
  );
  return {
    total: () => [...seen.values()].reduce((a, b) => a + b, 0),
    of: (i: number) => seen.get(i) ?? 0,
  };
}

describe('disposeSceneTree — release of the model GPU resources (F9)', () => {
  it('frees geometries, materials and textures of the whole subtree', () => {
    const geoA = new REAL.BufferGeometry();
    const geoB = new REAL.BufferGeometry();
    const tex = new REAL.Texture();
    const normal = new REAL.Texture();
    const mat = new REAL.MeshStandardMaterial({ map: tex, normalMap: normal });
    const root = new REAL.Group();
    root.add(new REAL.Mesh(geoA, mat), new REAL.Mesh(geoB, mat));

    const counts = disposeSceneTree(root);
    // The material and its two textures are shared by the two meshes: released once only.
    expect(counts).toEqual({ geometries: 2, materials: 1, textures: 2 });
  });

  it('never frees a shared resource twice', () => {
    const tex = new REAL.Texture();
    const matA = new REAL.MeshBasicMaterial({ map: tex });
    const matB = new REAL.MeshBasicMaterial({ map: tex });
    const suivi = countDisposals([tex, matA, matB]);
    const root = new REAL.Group();
    root.add(new REAL.Mesh(new REAL.BufferGeometry(), matA));
    root.add(new REAL.Mesh(new REAL.BufferGeometry(), matB));

    disposeSceneTree(root);
    expect(suivi.of(0)).toBe(1); // the shared texture: one release, not two
    expect(suivi.total()).toBe(3);
  });

  it('spares the resources placed in `seen` (still used elsewhere)', () => {
    const partagee = new REAL.Texture();
    const suivi = countDisposals([partagee]);
    const mat = new REAL.MeshBasicMaterial({ map: partagee });
    const root = new REAL.Group();
    root.add(new REAL.Mesh(new REAL.BufferGeometry(), mat));

    const counts = disposeSceneTree(root, new Set<object>([partagee]));
    expect(suivi.of(0)).toBe(0);
    expect(counts.textures).toBe(0);
    expect(counts.materials).toBe(1);
  });

  it('frees the material arrays and the textures of a ShaderMaterial', () => {
    const a = new REAL.MeshBasicMaterial({ map: new REAL.Texture() });
    const b = new REAL.ShaderMaterial({ uniforms: { uMap: { value: new REAL.Texture() } } });
    const root = new REAL.Group();
    root.add(new REAL.Mesh(new REAL.BufferGeometry(), [a, b]));

    expect(disposeSceneTree(root)).toEqual({ geometries: 1, materials: 2, textures: 2 });
  });
});

describe('createModelScene.dispose — complete cleanup of the viewer (F9)', () => {
  it('traverses the scene: the loaded model releases its geometries, materials and textures', () => {
    const { scene, renderer } = makeScene();
    const geo = new REAL.BufferGeometry();
    const tex = new REAL.Texture();
    const mat = new REAL.MeshStandardMaterial({ map: tex });
    const suivi = countDisposals([geo, mat, tex]);
    scene.root.add(new REAL.Mesh(geo, mat));

    scene.dispose();

    // Without the traversal, `renderer.dispose()` only frees JS caches: these three
    // counters stayed at zero and the GPU memory never went back down.
    expect(suivi.total()).toBe(3);
    expect(renderer.disposed).toBe(1);
    // The WebGL context itself is released: Chrome caps the number of contexts.
    expect(renderer.contextLost).toBe(1);
    expect(scene.renderer.domElement.isConnected).toBe(false);
  });

  it('does not take away the HDRI environment, which belongs to the lighting hook', () => {
    const { scene } = makeScene();
    const env = new REAL.Texture();
    const suivi = countDisposals([env]);
    scene.scene.environment = env;
    scene.scene.background = env;

    scene.dispose();
    expect(suivi.of(0)).toBe(0);
  });

  it('is idempotent: a second call releases nothing', () => {
    const { scene, renderer } = makeScene();
    const geo = new REAL.BufferGeometry();
    const suivi = countDisposals([geo]);
    scene.root.add(new REAL.Mesh(geo, new REAL.MeshBasicMaterial()));

    scene.dispose();
    scene.dispose();
    expect(suivi.of(0)).toBe(1);
    expect(renderer.disposed).toBe(1);
    expect(renderer.contextLost).toBe(1);
  });
});
