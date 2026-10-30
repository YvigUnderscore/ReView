// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SceneViewer } from '../viewer/sceneHandle';
import { turntableStep, type TurntableAxis } from './turntable';

/** Subscription controller to the render loop (provided by `useModel3DThree`). */
interface FrameSource {
  subscribeFrame: (cb: (dt: number) => void) => () => void;
}

/**
 * Configurable turntable (39.D): automatically rotates the view around the target (X/Y/Z axis,
 * speed in °/s). **Session-local** — an inspection preview, not persisted, non-destructive (it alters
 * neither the model nor the presentation). Subscribes to the render loop while active.
 */
export function useTurntable(viewer: SceneViewer & FrameSource) {
  const { ready, getSceneHandle, subscribeFrame } = viewer;
  const [active, setActive] = useState(false);
  const [axis, setAxis] = useState<TurntableAxis>('y');
  const [speed, setSpeed] = useState(30); // °/s
  // Read in the loop without restarting the subscription on each speed/axis change.
  const cfg = useRef({ axis, speed });
  useEffect(() => {
    cfg.current = { axis, speed };
  }, [axis, speed]);

  useEffect(() => {
    if (!ready || !active) return;
    return subscribeFrame((dt) => {
      const h = getSceneHandle();
      if (!h) return;
      const delta = ((cfg.current.speed * Math.PI) / 180) * dt;
      turntableStep(h.THREE, h.camera, h.controls, cfg.current.axis, delta);
    });
  }, [ready, active, getSceneHandle, subscribeFrame]);

  const toggle = useCallback(() => setActive((v) => !v), []);
  return { active, toggle, axis, setAxis, speed, setSpeed };
}

export type TurntableState = ReturnType<typeof useTurntable>;
