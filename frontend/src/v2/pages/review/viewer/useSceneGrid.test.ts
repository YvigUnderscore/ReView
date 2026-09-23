// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EXCLUDE_FROM_CAPTURE, hideCaptureMarkers } from './viewCapture';
import { GRID_RENDER_ORDER, createSceneGrid, type SceneGridTarget } from './useSceneGrid';

/**
 * WebGL est absent des tests : on ne peut pas constater un pixel, mais tout ce qui DÉCIDE de
 * l'image l'est — les propriétés de matériau et la clé de tri que Three lit sur l'objet. Le nuage
 * de Spark est remplacé par ce que Three voit de lui : un `Mesh` transparent d'ordre 0, de quad
 * centré sur l'origine, qui n'écrit pas la profondeur (`SparkRenderer`).
 */
function fakeSpark(): THREE.Mesh {
  // Le quad de `SplatGeometry` : -1..1 sur XY, donc de sphère englobante centrée sur l'origine.
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  return new THREE.Mesh(geometry, material);
}

/**
 * Point que Three projette pour trier un objet transparent : le centre de la sphère englobante de
 * sa géométrie, passé en monde (`WebGLRenderer.projectObject`). Deux objets qui partagent ce point
 * partagent leur distance de tri, quelle que soit la caméra — c'est là que la grille et le nuage
 * se retrouvaient à égalité.
 */
function sortCenter(object: THREE.Mesh | THREE.LineSegments): THREE.Vector3 {
  object.updateMatrixWorld(true);
  const geometry = object.geometry;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere;
  if (!sphere) throw new Error('géométrie sans sphère englobante');
  return sphere.center.clone().applyMatrix4(object.matrixWorld);
}

/** Scène de viewer : le nuage est monté d'abord, comme `createScene` avant l'effet de la grille. */
function mountScene(): { target: SceneGridTarget; spark: THREE.Mesh; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  const spark = fakeSpark();
  scene.add(spark);
  return { target: { THREE, scene }, spark, scene };
}

describe('useSceneGrid — la grille de sol ne traverse plus le nuage (lot 15)', () => {
  it('passe avant le nuage dans la passe transparente', () => {
    const { target, spark } = mountScene();
    const { grid } = createSceneGrid(target);

    // Les trois clés de `reversePainterSortStable`, dans son ordre : l'ordre de rendu tranche…
    expect(grid.renderOrder).toBe(GRID_RENDER_ORDER);
    expect(grid.renderOrder).toBeLessThan(spark.renderOrder);
    // …parce que les deux suivantes ne tranchaient pas : même distance de tri…
    expect(sortCenter(grid).equals(sortCenter(spark))).toBe(true);
    // …et un `id` plus grand pour la grille, née après le renderer Spark, qui la faisait passer
    // en DERNIER — le quadrillage par-dessus les splats que l'utilisateur voit.
    expect(grid.id).toBeGreaterThan(spark.id);
  });

  it('garde son aspect : transparente à 0,25, sans écriture de profondeur, testée en profondeur', () => {
    const { target } = mountScene();
    const { grid } = createSceneGrid(target);
    const mat = grid.material;

    // Le viewer 3D partage ce hook : la grille doit y rester exactement ce qu'elle était.
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBe(0.25);
    expect(mat.depthWrite).toBe(false);
    // Le test de profondeur reste actif : un maillage opaque du viewer 3D masque la grille.
    expect(mat.depthTest).toBe(true);
  });

  it('reste un repère d’écran : la capture de vue la retire, puis la remet', () => {
    const { target, scene } = mountScene();
    const { grid } = createSceneGrid(target);
    expect(grid.userData[EXCLUDE_FROM_CAPTURE]).toBe(true);

    const show = hideCaptureMarkers(scene);
    expect(grid.visible).toBe(false);
    show();
    expect(grid.visible).toBe(true);
  });

  it('se démonte sans laisser la grille dans la scène', () => {
    const { target, scene, spark } = mountScene();
    const { grid, dispose } = createSceneGrid(target);
    expect(scene.children).toContain(grid);

    dispose();
    expect(scene.children).not.toContain(grid);
    expect(scene.children).toContain(spark);
  });
});
