// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSelectionGlow } from './selectionGlow';

/** `Xform` group carrying two meshes — the shape of a converted USD prim. */
function makeScene() {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  group.add(a, b);
  scene.add(group);
  return { scene, group, a, b };
}

const shellsOf = (scene: THREE.Scene) =>
  scene.children.find((o) => o.name === 'review-selection-glow')?.children.length ?? -1;

describe('createSelectionGlow — selection halo (46)', () => {
  it('surrounds the meshes of the descendants of a selected group', () => {
    const { scene, group } = makeScene();
    const glow = createSelectionGlow(THREE, scene);
    // A USD prim is almost always an Xform: without descending, nothing would be surrounded.
    glow.show([group]);
    expect(shellsOf(scene)).toBe(2);
    glow.dispose();
  });

  it('ignores a mesh hidden by a parent', () => {
    const { scene, group, a } = makeScene();
    a.visible = false;
    const glow = createSelectionGlow(THREE, scene);
    glow.show([group]);
    expect(shellsOf(scene)).toBe(1);
    glow.dispose();
  });

  it('surrounds nothing when the whole subtree is hidden', () => {
    const { scene, group } = makeScene();
    group.visible = false;
    const glow = createSelectionGlow(THREE, scene);
    glow.show([group]);
    expect(shellsOf(scene)).toBe(0);
    glow.dispose();
  });

  it('an empty selection clears the halo, and dispose removes the group', () => {
    const { scene, group } = makeScene();
    const glow = createSelectionGlow(THREE, scene);
    glow.show([group]);
    glow.show([]);
    expect(shellsOf(scene)).toBe(0);
    glow.dispose();
    expect(shellsOf(scene)).toBe(-1);
  });

  it('stays aligned on an off-center geometry (transforms baked into the vertices)', () => {
    const scene = new THREE.Scene();
    // Blender often bakes the position into the vertices: geometry far from the local origin.
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.translate(10, 0, 0);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    scene.add(mesh);
    const glow = createSelectionGlow(THREE, scene);
    glow.show([mesh]);

    const shell = scene.children.find((o) => o.name === 'review-selection-glow')!.children[0] as THREE.Mesh;
    // The geometry center must stay at exactly the same world point: dilation happens around
    // it, not around the origin (which would shift the halo by 4% of the distance).
    const center = geometry.boundingSphere!.center.clone();
    const viaShell = center.clone().applyMatrix4(shell.matrix);
    const viaMesh = center.clone().applyMatrix4(mesh.matrixWorld);
    expect(viaShell.distanceTo(viaMesh)).toBeLessThan(1e-6);
    // And a point on the edge is indeed dilated by SHELL_SCALE around that center.
    const edge = center.clone().add(new THREE.Vector3(0.5, 0, 0));
    const shellEdge = edge.clone().applyMatrix4(shell.matrix);
    expect(shellEdge.x - viaShell.x).toBeCloseTo(0.5 * 1.04, 5);
    glow.dispose();
  });

  it('stays out of the raycast: it is an interface marker', () => {
    const { scene, group } = makeScene();
    const glow = createSelectionGlow(THREE, scene);
    glow.show([group]);
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    const glowGroup = scene.children.find((o) => o.name === 'review-selection-glow')!;
    expect(raycaster.intersectObject(glowGroup, true)).toHaveLength(0);
    glow.dispose();
  });
});
