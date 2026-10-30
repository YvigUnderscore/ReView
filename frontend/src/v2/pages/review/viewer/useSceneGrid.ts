// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState } from 'react';
import type * as THREE from 'three';
import type { SceneViewer, ViewerSceneHandle } from './sceneHandle';
import { EXCLUDE_FROM_CAPTURE } from './viewCapture';

const STORAGE_KEY = 'review-grid-visible';

/**
 * Render order of the grid: **first of the transparent pass**, so it is drawn before the
 * Gaussian splat cloud (lot 15).
 *
 * WHY. The grid used to show THROUGH the splats. Spark does not draw `SplatMesh` objects one by
 * one — they are `Object3D`s without material: the whole cloud (A/B comparison included) comes
 * out of a single `SparkRenderer`, a `THREE.Mesh` with `transparent: true` / `depthTest: true` /
 * `depthWrite: false`, render order 0. The grid is also transparent and does not write depth:
 * nothing separates them except the sort of the transparent pass (`reversePainterSortStable`),
 * which compares render order, then distance, then the object's `id`. Both geometries are centred
 * on the origin — their sort distance is therefore EXACTLY the same — and the grid is created
 * after the Spark renderer: its `id` is larger, so it was drawn last, over the cloud. Nothing
 * "angle-dependent" about it: it was wrong on every frame, which is what the user observed.
 *
 * WHAT IT COSTS. The grid now draws under EVERYTHING transparent, and there is still no depth
 * test between it and the cloud (which does not write depth): a very translucent cloud lets it
 * show through faintly, and a grid line stretched IN FRONT of the cloud is covered by it. This is
 * the price of a cloud without depth, and the only lever within reach: making the cloud write
 * depth would break its own back-to-front fade, and the brush strokes explicitly rely on the
 * opposite (`splat/paint/strokes.ts`: "above the splats (which do not write depth)").
 *
 * The other markers stay above, deliberately: brush strokes (5), plan camera, measure gizmo and
 * skeleton overlay (999), transform gizmo (`Infinity`, set by `TransformControls`). POI pins and
 * the letterbox guide are DOM, outside this sort. The cut volumes' wireframe is opaque: it is
 * drawn before the whole transparent pass.
 */
export const GRID_RENDER_ORDER = -1;

/** What a viewer must provide to place the grid: the Three modules and the scene. */
export type SceneGridTarget = Pick<ViewerSceneHandle, 'THREE' | 'scene'>;

export interface MountedSceneGrid {
  grid: THREE.GridHelper;
  /** Removes the grid from the scene and frees its geometry/material. */
  dispose: () => void;
}

/**
 * Places the floor grid in a mounted scene and returns its teardown. Kept separate from the hook:
 * everything that decides the look and the drawing ORDER can thus be tested without React or WebGL.
 */
export function createSceneGrid(target: SceneGridTarget): MountedSceneGrid {
  const grid = new target.THREE.GridHelper(20, 40, 0x8888aa, 0x444455);
  grid.userData[EXCLUDE_FROM_CAPTURE] = true; // screen-space marker: excluded from the view capture
  const mat = grid.material;
  mat.transparent = true;
  mat.opacity = 0.25;
  mat.depthWrite = false;
  grid.renderOrder = GRID_RENDER_ORDER; // under the cloud: see the comment above
  target.scene.add(grid);
  return {
    grid,
    dispose: () => {
      target.scene.remove(grid);
      grid.dispose();
    },
  };
}

/**
 * Floor grid of the 3D/splat viewers: orientation marker for the scene (plane Y=0), toggleable
 * from the HUD, preference persisted in localStorage. One code path for both viewers via the
 * shared `SceneViewer` handle (Phase 17).
 *
 * It is a SCREEN-space marker: the view capture removes it (see `viewCapture`), since an image
 * headed into a composition has no use for the grid that helps orient the viewer.
 */
export function useSceneGrid(viewer: SceneViewer): { visible: boolean; toggle: () => void } {
  const [visible, setVisible] = useState(() => localStorage.getItem(STORAGE_KEY) !== '0');
  const { ready, getSceneHandle } = viewer;

  useEffect(() => {
    const h = getSceneHandle();
    if (!ready || !h || !visible) return;
    const mounted = createSceneGrid(h);
    return mounted.dispose;
  }, [ready, getSceneHandle, visible]);

  const toggle = useCallback(() => {
    setVisible((v) => {
      localStorage.setItem(STORAGE_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  return { visible, toggle };
}
