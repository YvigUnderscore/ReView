// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { poseForScale } from './loadModel';
import type { SceneRuntime } from './useModel3DThree';

/**
 * Real-size toggle of the 3D viewer.
 *
 * Loading brings every model back to two world units so that framing stays consistent whatever the
 * export — convenient for presenting, wrong for inspecting: a 20 cm prop and a 30 m set look identical
 * there. The normalization factor is now **kept** (`SceneRuntime.normScale`), so the toggle reloads
 * nothing: it re-poses the wrapper at scale 1 (file units) or at the normalized scale, updates the
 * radius and center on which framing and the turntable depend, then reframes.
 *
 * `near`/`far` are recomputed right after: at real scale, a 30 m set would fall outside the frustum
 * set for a 2-unit object, and a 2 cm object would vanish into the near plane.
 *
 * The setting is an **inspection preference**: it survives the media change, and `reapplyRef` replays
 * it on the model that has just loaded (otherwise the switch would claim a real scale in front of a
 * normalized model).
 */
export function useModelScale(params: {
  runtimeRef: RefObject<SceneRuntime | null>;
  threeRef: RefObject<typeof import('three') | null>;
  homeView: () => void;
  /** Filled by the hook: called by the loading loop, once the runtime is in place. */
  reapplyRef: RefObject<(() => void) | null>;
}) {
  const { runtimeRef, threeRef, homeView, reapplyRef } = params;
  const [realScale, setRealScaleState] = useState(false);
  const realScaleRef = useRef(false);

  /** Re-poses the wrapper at the requested scale (no React state touched). */
  const pose = useCallback(
    (on: boolean, refit: boolean) => {
      const rt = runtimeRef.current;
      const THREE = threeRef.current;
      if (!rt || !THREE) return;
      const next = poseForScale(THREE, rt.modelBox, on ? 1 : rt.normScale);
      rt.modelObject.scale.setScalar(next.scale);
      rt.modelObject.position.copy(next.position);
      rt.modelRadius = next.radius;
      rt.modelCenter = next.center;
      const { camera } = rt.scene;
      camera.near = rt.layoutCam.near = Math.max(next.radius / 100, 0.000001);
      camera.far = rt.layoutCam.far = Math.max(next.radius * 100, 1);
      camera.updateProjectionMatrix();
      rt.layoutCam.updateProjectionMatrix();
      if (refit) homeView();
    },
    [runtimeRef, threeRef, homeView],
  );

  useEffect(() => {
    // The freshly loaded model is normalized: the current preference is applied to it, framing
    // included — the initial framing was computed on the normalized radius.
    reapplyRef.current = () => realScaleRef.current && pose(true, true);
    return () => {
      reapplyRef.current = null;
    };
  }, [pose, reapplyRef]);

  const setRealScale = useCallback(
    (on: boolean) => {
      realScaleRef.current = on;
      setRealScaleState(on);
      pose(on, true);
    },
    [pose],
  );

  return { realScale, setRealScale };
}
