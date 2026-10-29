// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EXCLUDE_FROM_CAPTURE, hideCaptureMarkers } from './viewCapture';
import { GRID_RENDER_ORDER, createSceneGrid, type SceneGridTarget } from './useSceneGrid';

/**
 * WebGL is absent from the tests: a pixel cannot be checked, but everything that DECIDES the image
 * can — the material properties and the sort key Three reads on the object. Spark's cloud is
 * replaced by what Three sees of it: a transparent `Mesh` of order 0, a quad centred on the
 * origin, which does not write depth (`SparkRenderer`).
 */
function fakeSpark(): THREE.Mesh {
  // The quad of `SplatGeometry`: -1..1 on XY, so its bounding sphere is centred on the origin.
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  return new THREE.Mesh(geometry, material);
}

/**
 * Point Three projects to sort a transparent object: the centre of its geometry's bounding sphere,
 * brought to world space (`WebGLRenderer.projectObject`). Two objects that share this point share
 * their sort distance whatever the camera — this is where the grid and the cloud were tied.
 */
function sortCenter(object: THREE.Mesh | THREE.LineSegments): THREE.Vector3 {
  object.updateMatrixWorld(true);
  const geometry = object.geometry;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere;
  if (!sphere) throw new Error('geometry without bounding sphere');
  return sphere.center.clone().applyMatrix4(object.matrixWorld);
}

/** Viewer scene: the cloud is mounted first, as `createScene` does before the grid effect. */
function mountScene(): { target: SceneGridTarget; spark: THREE.Mesh; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  const spark = fakeSpark();
  scene.add(spark);
  return { target: { THREE, scene }, spark, scene };
}

describe('useSceneGrid — the floor grid no longer shows through the cloud (lot 15)', () => {
  it('draws before the cloud in the transparent pass', () => {
    const { target, spark } = mountScene();
    const { grid } = createSceneGrid(target);

    // The three keys of `reversePainterSortStable`, in order: render order decides…
    expect(grid.renderOrder).toBe(GRID_RENDER_ORDER);
    expect(grid.renderOrder).toBeLessThan(spark.renderOrder);
    // …because the next two did not decide: same sort distance…
    expect(sortCenter(grid).equals(sortCenter(spark))).toBe(true);
    // …and a larger `id` for the grid, created after the Spark renderer, which made it draw
    // LAST — the grid over the splats the user sees.
    expect(grid.id).toBeGreaterThan(spark.id);
  });

  it('keeps its look: transparent at 0.25, no depth write, depth-tested', () => {
    const { target } = mountScene();
    const { grid } = createSceneGrid(target);
    const mat = grid.material;

    // The 3D viewer shares this hook: the grid must stay exactly what it was there.
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBe(0.25);
    expect(mat.depthWrite).toBe(false);
    // The depth test stays active: an opaque mesh of the 3D viewer hides the grid.
    expect(mat.depthTest).toBe(true);
  });

  it('stays a screen-space marker: the view capture removes it, then restores it', () => {
    const { target, scene } = mountScene();
    const { grid } = createSceneGrid(target);
    expect(grid.userData[EXCLUDE_FROM_CAPTURE]).toBe(true);

    const show = hideCaptureMarkers(scene);
    expect(grid.visible).toBe(false);
    show();
    expect(grid.visible).toBe(true);
  });

  it('unmounts without leaving the grid in the scene', () => {
    const { target, scene, spark } = mountScene();
    const { grid, dispose } = createSceneGrid(target);
    expect(scene.children).toContain(grid);

    dispose();
    expect(scene.children).not.toContain(grid);
    expect(scene.children).toContain(spark);
  });
});
