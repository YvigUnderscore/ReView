// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import { isDrawn } from './sceneOverrideApply';

/**
 * Selection halo of the 3D viewer (Phase 46): a slightly dilated additive shell around the meshes
 * of the selected prim.
 *
 * A shell rather than tinting the materials: glTF materials are **shared** between objects, so
 * modifying them would color unselected meshes and require a fragile save/restore. Here we only add
 * disposable objects, removed on deselection — the original scene is never touched.
 */

/** Thickness of the halo, as a fraction of the object's scale. */
const SHELL_SCALE = 1.04;
/** Halo color — the theme accent (cyan), readable on both dark and light backgrounds. */
export const GLOW_COLOR = 0x22d3ee;

export interface SelectionGlow {
  /**
   * Surrounds the given objects **and their descendants**; an empty list clears the halo.
   * A selected prim is most often a group (`Xform`): surrounding only the objects themselves would
   * draw nothing as soon as something other than a leaf is selected.
   */
  show(objects: readonly THREE.Object3D[]): void;
  dispose(): void;
}

/**
 * Creates the halo manager. The group lives in the scene but outside the model's hierarchy, so it
 * is never captured by prim indexing nor by a raycast.
 */
export function createSelectionGlow(three: typeof import('three'), scene: THREE.Scene): SelectionGlow {
  const group = new three.Group();
  group.name = 'review-selection-glow';
  // Excluded from raycasts and thumbnail capture: it is an interface marker, not scene content.
  group.raycast = () => {};
  scene.add(group);

  const material = new three.MeshBasicMaterial({
    color: GLOW_COLOR,
    transparent: true,
    opacity: 0.35,
    // `BackSide` only draws the back face of the dilated shell: the halo appears as an
    // outline, without hiding the object.
    side: three.BackSide,
    depthWrite: false,
    blending: three.AdditiveBlending,
  });

  const clear = () => {
    for (const child of [...group.children]) group.remove(child);
  };

  return {
    show(objects) {
      clear();
      for (const object of objects) {
        object.traverse((node) => {
          const mesh = node as THREE.Mesh & { isMesh?: boolean };
          // A mesh the scene does not draw (inactive variant option, prim hidden by a
          // parent) must not be surrounded: the halo would reveal an invisible object.
          if (!mesh.isMesh || !mesh.geometry || !isDrawn(mesh)) return;
          const shell = new three.Mesh(mesh.geometry, material);
          shell.raycast = () => {};
          mesh.updateWorldMatrix(true, false);
          // The shell is placed in world space: it follows the object without depending on its
          // place in the hierarchy (and so is not hidden along with an invisible parent).
          //
          // Dilation happens around the **geometry center**, not the local origin: Blender often
          // bakes transforms into the vertices (origin left at the world center), and dilating
          // around the origin would shift the halo more the farther the object is from it.
          if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
          const c = mesh.geometry.boundingSphere?.center ?? new three.Vector3();
          shell.matrixAutoUpdate = false;
          shell.matrix
            .copy(mesh.matrixWorld)
            .multiply(new three.Matrix4().makeTranslation(c.x, c.y, c.z))
            .multiply(new three.Matrix4().makeScale(SHELL_SCALE, SHELL_SCALE, SHELL_SCALE))
            .multiply(new three.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
          group.add(shell);
        });
      }
    },
    dispose() {
      clear();
      scene.remove(group);
      material.dispose();
    },
  };
}
