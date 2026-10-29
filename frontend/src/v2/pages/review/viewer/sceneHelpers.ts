// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/**
 * Scene **helper** objects — camera object, target marker, trajectory, gizmo. They belong to the
 * free view, the one where the artist manipulates them; they have no business in the **PiP**,
 * which is the plan view, i.e. the image that will be delivered.
 *
 * WHY IT MATTERS FOR VISUAL FEEDBACK. These objects are **rigid relative to the plan camera**:
 * the PiP looks from the camera object's position towards its target marker, so the wireframe
 * frustum runs from in front of the lens to the four corners of the frame and the marker sits
 * dead centre — whatever the plan does. Drawn in the PiP, they form an image that **never**
 * moves: the PiP looked frozen while the camera was in fact moving.
 *
 * A module-level registry rather than a prop chain: the splat PiP pass is written in the
 * `useSplat` loop, the 3D one in `useModelLayout` — two callers that do not have access to the
 * camera rig, which itself is mounted by the review page. Objects are hidden then restored within
 * the **same** loop tick, with no render in between: two viewers mounted at the same time (A/B
 * comparison) therefore cannot interfere with each other.
 */

const helpers = new Set<THREE.Object3D>();

/** Declares helper objects; the returned function removes them (rig unmount). */
export function registerSceneHelpers(...objects: readonly THREE.Object3D[]): () => void {
  for (const object of objects) helpers.add(object);
  return () => {
    for (const object of objects) helpers.delete(object);
  };
}

/**
 * Runs `draw` with the helper objects hidden, then restores exactly those that were visible — an
 * object already hidden for another reason (`setVisible(false)`) stays hidden.
 */
export function renderWithoutHelpers(draw: () => void): void {
  const hidden: THREE.Object3D[] = [];
  for (const object of helpers) {
    if (!object.visible) continue;
    object.visible = false;
    hidden.push(object);
  }
  try {
    draw();
  } finally {
    for (const object of hidden) object.visible = true;
  }
}

/** Number of declared helper objects — used by tests (the registry is deliberately private). */
export function sceneHelperCount(): number {
  return helpers.size;
}
