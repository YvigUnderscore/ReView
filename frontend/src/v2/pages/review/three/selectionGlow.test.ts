// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSelectionGlow } from './selectionGlow';

/** Groupe `Xform` portant deux meshes — la forme d'un prim USD converti. */
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

describe('createSelectionGlow — halo de sélection (46)', () => {
  it('entoure les meshes de la descendance d’un groupe sélectionné', () => {
    const { scene, group } = makeScene();
    const glow = createSelectionGlow(THREE, scene);
    // Un prim USD est presque toujours un Xform : sans descente, rien ne serait entouré.
    glow.show([group]);
    expect(shellsOf(scene)).toBe(2);
    glow.dispose();
  });

  it('ignore un mesh masqué par un parent', () => {
    const { scene, group, a } = makeScene();
    a.visible = false;
    const glow = createSelectionGlow(THREE, scene);
    glow.show([group]);
    expect(shellsOf(scene)).toBe(1);
    glow.dispose();
  });

  it('n’entoure rien quand tout le sous-arbre est masqué', () => {
    const { scene, group } = makeScene();
    group.visible = false;
    const glow = createSelectionGlow(THREE, scene);
    glow.show([group]);
    expect(shellsOf(scene)).toBe(0);
    glow.dispose();
  });

  it('une sélection vide efface le halo, et dispose retire le groupe', () => {
    const { scene, group } = makeScene();
    const glow = createSelectionGlow(THREE, scene);
    glow.show([group]);
    glow.show([]);
    expect(shellsOf(scene)).toBe(0);
    glow.dispose();
    expect(shellsOf(scene)).toBe(-1);
  });

  it('reste aligné sur une géométrie excentrée (transformations cuites dans les sommets)', () => {
    const scene = new THREE.Scene();
    // Blender cuit souvent la position dans les sommets : géométrie loin de l'origine locale.
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.translate(10, 0, 0);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    scene.add(mesh);
    const glow = createSelectionGlow(THREE, scene);
    glow.show([mesh]);

    const shell = scene.children.find((o) => o.name === 'review-selection-glow')!.children[0] as THREE.Mesh;
    // Le centre de la géométrie doit rester exactement au même point monde : la dilatation se
    // fait autour de lui, pas autour de l'origine (qui décalerait le halo de 4 % de la distance).
    const center = geometry.boundingSphere!.center.clone();
    const viaShell = center.clone().applyMatrix4(shell.matrix);
    const viaMesh = center.clone().applyMatrix4(mesh.matrixWorld);
    expect(viaShell.distanceTo(viaMesh)).toBeLessThan(1e-6);
    // Et un point du bord est bien dilaté de SHELL_SCALE autour de ce centre.
    const edge = center.clone().add(new THREE.Vector3(0.5, 0, 0));
    const shellEdge = edge.clone().applyMatrix4(shell.matrix);
    expect(shellEdge.x - viaShell.x).toBeCloseTo(0.5 * 1.04, 5);
    glow.dispose();
  });

  it('reste hors du raycast : c’est un repère d’interface', () => {
    const { scene, group } = makeScene();
    const glow = createSelectionGlow(THREE, scene);
    glow.show([group]);
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    const glowGroup = scene.children.find((o) => o.name === 'review-selection-glow')!;
    expect(raycaster.intersectObject(glowGroup, true)).toHaveLength(0);
    glow.dispose();
  });
});
