// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SceneViewer } from '../viewer/sceneHandle';
import { makeClipPlane, type SectionAxis } from './sectionPlane';
import type { SectionState } from './viewState';

type Bounds = Record<SectionAxis, { min: number; max: number }>;

/**
 * Section plane of the 3D viewer (39.D): masks one half of the model along an axis, at a
 * **scrubbable** position (drag/type in the HUD → "draggable" per the app idiom), with inversion of
 * the kept side. **Session-local**, non-destructive (`renderer.clippingPlanes`, restored on
 * deactivation). The position bounds come from the model's bounding box.
 */
export function useSectionPlane(viewer: SceneViewer) {
  const { ready, getSceneHandle } = viewer;
  const [active, setActive] = useState(false);
  const [axis, setAxisState] = useState<SectionAxis>('x');
  const [flip, setFlip] = useState(false);
  const [position, setPosition] = useState(0);

  // Model bounding box → position bounds per axis. Read-only (memo, not an effect).
  const bounds = useMemo<Bounds | null>(() => {
    if (!ready) return null;
    const h = getSceneHandle();
    if (!h?.mesh) return null;
    const box = new h.THREE.Box3().setFromObject(h.mesh);
    if (box.isEmpty()) return null;
    return {
      x: { min: box.min.x, max: box.max.x },
      y: { min: box.min.y, max: box.max.y },
      z: { min: box.min.z, max: box.max.z },
    };
  }, [ready, getSceneHandle]);

  // Applies/removes the section plane (global renderer) according to the state.
  useEffect(() => {
    const h = getSceneHandle();
    if (!h?.renderer) return;
    h.renderer.clippingPlanes = active ? [makeClipPlane(h.THREE, axis, position, flip)] : [];
    return () => {
      const hh = getSceneHandle();
      if (hh?.renderer) hh.renderer.clippingPlanes = [];
    };
  }, [ready, getSceneHandle, active, axis, position, flip]);

  const center = useCallback((a: SectionAxis, b: Bounds | null) => {
    const r = b?.[a];
    if (r) setPosition((r.min + r.max) / 2);
  }, []);

  const toggle = useCallback(() => {
    setActive((v) => {
      if (!v) center(axis, bounds); // re-centers on activation
      return !v;
    });
  }, [axis, bounds, center]);

  const setAxis = useCallback(
    (a: SectionAxis) => {
      setAxisState(a);
      center(a, bounds);
    },
    [bounds, center],
  );

  /**
   * Replays a captured section plane (view state of a comment): the four settings are set in one
   * block, without the re-centering triggered by a manual axis change — the recorded position is the
   * one to restore, not the bbox midpoint.
   */
  const apply = useCallback((s: SectionState) => {
    setActive(s.active);
    setAxisState(s.axis);
    setPosition(s.position);
    setFlip(s.flip);
  }, []);

  const cur = bounds?.[axis] ?? { min: -1, max: 1 };
  return {
    active,
    toggle,
    axis,
    setAxis,
    position,
    setPosition,
    flip,
    toggleFlip: useCallback(() => setFlip((f) => !f), []),
    apply,
    bounds: cur,
  };
}

export type SectionPlaneState = ReturnType<typeof useSectionPlane>;
