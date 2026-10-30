// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { boxLengths, formatLength, worldToMetres } from './measure';
import { createMeasureGizmo, type MeasureGizmo } from './measureGizmo';
import { raycastSurface } from './objectHotspot';
import { isClickGesture, toNdc } from './usdPicking';
import type { Model3DThreeState } from './useModel3DThree';

/**
 * Point-to-point measurement tool of the 3D viewer (39.G) and dimensions of the bounding box.
 *
 * Two points are clicked on the surface: the marker joins them and the length is displayed in the
 * Info panel, expressed in meters via the `metersPerUnit` of the USD scene. A third click starts a
 * new segment. The scale actually applied is **read from the world matrix** of the model
 * (normalization × user transform): measuring at real size or at normalized size therefore gives the
 * same result, as it should.
 *
 * The tool only installs its listeners while armed: outside measurement, the click keeps its usual
 * role (prim selection).
 */
export function useModelMeasure(model3d: Model3DThreeState, metersPerUnit = 1) {
  const { ready, getSceneHandle, modelSize } = model3d;
  const [active, setActive] = useState(false);
  const [points, setPoints] = useState(0);
  const [metres, setMetres] = useState<number | null>(null);
  const gizmoRef = useRef<MeasureGizmo | null>(null);
  // `metersPerUnit` changes with the media, not during a measurement: a ref avoids reinstalling
  // the listeners (and thus erasing the ongoing measurement) on every review render.
  const mpuRef = useRef(metersPerUnit);
  useEffect(() => {
    mpuRef.current = metersPerUnit;
  }, [metersPerUnit]);

  const clear = useCallback(() => {
    gizmoRef.current?.setPoints([]);
    setPoints(0);
    setMetres(null);
  }, []);

  const toggle = useCallback(() => setActive((v) => !v), []);

  useEffect(() => {
    if (!active || !ready) return;
    const handle = getSceneHandle();
    const dom = handle?.dom;
    const root = handle?.modelObject;
    if (!handle || !dom || !root) return;
    const { THREE: three } = handle;
    const sphere = new three.Box3().setFromObject(root).getBoundingSphere(new three.Sphere());
    const gizmo = createMeasureGizmo(three, handle.scene, sphere.radius);
    gizmoRef.current = gizmo;
    let picked: THREE.Vector3[] = [];
    let down: { x: number; y: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      // Same guard as prim selection: a left click that slid is an orbit.
      if (e.button !== 0 || !start || !isClickGesture(e.clientX - start.x, e.clientY - start.y)) return;
      const ndc = toNdc(e.clientX, e.clientY, dom.getBoundingClientRect());
      const hit = raycastSurface(three, handle.camera, root, ndc);
      if (!hit) return;
      picked = picked.length >= 2 ? [hit.point.clone()] : [...picked, hit.point.clone()];
      gizmo.setPoints(picked);
      setPoints(picked.length);
      if (picked.length < 2) {
        setMetres(null);
        return;
      }
      const worldScale = root.getWorldScale(new three.Vector3()).x;
      setMetres(worldToMetres(picked[0].distanceTo(picked[1]), worldScale, mpuRef.current));
    };

    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    return () => {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      gizmo.dispose();
      gizmoRef.current = null;
      setPoints(0);
      setMetres(null);
    };
  }, [active, ready, getSceneHandle]);

  return {
    active,
    toggle,
    clear,
    /** Number of points placed (0, 1 or 2) — the panel prompts to place the second. */
    points,
    /** Measured length, `null` until both points are placed. */
    length: metres == null ? null : formatLength(metres),
    /** Dimensions of the file's bounding box, in readable lengths. */
    dimensions: modelSize ? boxLengths(modelSize, metersPerUnit) : null,
  };
}

export type ModelMeasureState = ReturnType<typeof useModelMeasure>;
