// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef } from 'react';
import type * as THREE from 'three';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { isClickGesture, pickPrim, toNdc } from './usdPicking';

/**
 * Resolves the prim targeted by a screen point. `exact` (Alt+click) bypasses promotion to the
 * enclosing component and descends to the leaf that was hit.
 */
export type UsdPickAt = (clientX: number, clientY: number, exact?: boolean) => string | null;

/**
 * Prim selection on click in the 3D viewer (Phase 46, 46.C).
 *
 * The left click also drives the orbit, so the gesture is only read as a selection if the pointer
 * has not moved between press and release. A click on empty space deselects, as in a DCC.
 *
 * The press position lives in a **ref** and not in the effect's scope: the viewer hook returns a new
 * object on every render, so a render happening between press and release would reinstall the
 * listeners and lose the origin of the gesture — every click would then count as a drag. For the
 * same reason, the effect only depends on `getSceneHandle`, which is stable.
 *
 * `ready` must be that of the Three viewer (`useModel3DThree.ready`): the effect only runs once,
 * and when wired to a "displayable media" it ran on a still-empty scene and never installed the
 * listeners — no click selected anything.
 *
 * `resolve` also goes through a ref: it is rebuilt when the scene index arrives, **after** the
 * listeners were installed. Captured in the effect's scope, it would stay that of an empty index,
 * and every click would resolve to `null`.
 *
 * The **right click** is no longer handled here. It carries two contradictory gestures (held
 * flight, brief context menu) and telling them apart is the job of a single module, shared with the
 * splat: `viewer/useSpatialContextMenu`. This hook only lends it its prim resolution, rendered by
 * `pickAt` — otherwise the menu would also open in the middle of a flight, where the pointer moved.
 */
export function useUsdPicking(
  getSceneHandle: () => ViewerSceneHandle | null,
  ready: boolean,
  onSelect: (path: string | null, opts?: { additive?: boolean }) => void,
  /**
   * Translates the hit object into a prim — the scene index, the only authoritative table.
   *
   * The viewer plugs `resolvePick` in there, which **promotes** the hit leaf to the enclosing USD
   * `component`: click a chair, select the chair. `exact` bypasses this promotion to descend to the
   * precise part; it is **Alt+click** that requests it — Ctrl/⌘ is already used for multi-selection,
   * and Shift for the range in the tree.
   */
  resolve: (object: THREE.Object3D, opts?: { exact?: boolean }) => string | null,
): UsdPickAt {
  const down = useRef<{ x: number; y: number } | null>(null);
  const resolveRef = useRef(resolve);
  useEffect(() => {
    resolveRef.current = resolve;
  }, [resolve]);

  /**
   * Prim targeted by a screen point. Built at hook level, not in the effect's scope: the spatial
   * context menu uses it when the right button is released, outside that effect.
   */
  const pickAt = useCallback<UsdPickAt>(
    (clientX, clientY, exact = false) => {
      const handle = getSceneHandle();
      const dom = handle?.dom;
      const root = handle?.modelObject;
      if (!handle || !dom || !root) return null;
      const rect = dom.getBoundingClientRect();
      return pickPrim(handle.THREE, handle.camera, root, toNdc(clientX, clientY, rect), (object) =>
        resolveRef.current(object, { exact }),
      );
    },
    [getSceneHandle],
  );

  useEffect(() => {
    if (!ready) return;
    const handle = getSceneHandle();
    const dom = handle?.dom;
    const root = handle?.modelObject;
    if (!handle || !dom || !root) return;

    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const start = down.current;
      down.current = null;
      if (e.button !== 0 || !start) return;
      if (!isClickGesture(e.clientX - start.x, e.clientY - start.y)) return;
      // Ctrl/⌘+click: adds or removes the prim from the selection (multi-selection B1).
      onSelect(pickAt(e.clientX, e.clientY, e.altKey), { additive: e.ctrlKey || e.metaKey });
    };

    // CAPTURE PHASE for pointer events.
    //
    // The camera controls sit on the same element and handle the LEFT button (orbit): their
    // `pointerdown` stopped propagation before this one recorded the origin of the gesture.
    // `down.current` thus stayed null, `onUp` exited immediately, and a left click never selected
    // anything — whereas the RIGHT click, which those controls handle differently (free flight),
    // did reach this module: the prim's menu opened and "Frame" targeted the right object. This
    // asymmetry is what put us on the track.
    //
    // Capture descends before any bubble listener: we note the origin of the gesture without
    // preventing anything — these two listeners call neither `preventDefault` nor
    // `stopPropagation`, so the orbit keeps working exactly as before.
    dom.addEventListener('pointerdown', onDown, true);
    dom.addEventListener('pointerup', onUp, true);
    return () => {
      dom.removeEventListener('pointerdown', onDown, true);
      dom.removeEventListener('pointerup', onUp, true);
    };
  }, [getSceneHandle, ready, onSelect, pickAt]);

  return pickAt;
}
