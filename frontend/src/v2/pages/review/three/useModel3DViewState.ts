// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import type { Model3DInspectState } from './useModel3DInspect';
import type { Model3DLightingState } from './useModel3DLighting';
import type { Model3DThreeState } from './useModel3DThree';
import type { SectionPlaneState } from './useSectionPlane';

/**
 * Hooks the **view state** (display mode, section plane, HDRI lighting) onto the viewer's camera
 * view: captured with the comment, replayed on its selection.
 *
 * A comment already carried the camera, the hotspot, the animation and the scene proposal — but not
 * what changes the image the most. "Look at what I see" therefore sent the reader to the right
 * camera in front of a different render: shaded instead of wireframe, cut closed, another HDRI.
 *
 * The three hooks are new objects on every render: the provider recalls them through a ref, which
 * keeps the registration stable (done once on mount).
 */
export function useModel3DViewState(params: {
  model3d: Model3DThreeState;
  inspect: Model3DInspectState;
  section: SectionPlaneState;
  lighting: Model3DLightingState;
}): void {
  const { model3d, inspect, section, lighting } = params;
  const { registerViewState } = model3d;
  const latest = useRef({ inspect, section, lighting });
  useEffect(() => {
    latest.current = { inspect, section, lighting };
  });

  useEffect(() => {
    registerViewState({
      capture: () => {
        const { inspect: i, section: s, lighting: l } = latest.current;
        return {
          display: i.mode,
          section: { active: s.active, axis: s.axis, position: s.position, flip: s.flip },
          lighting: l.cfg,
        };
      },
      apply: (state) => {
        const { inspect: i, section: s, lighting: l } = latest.current;
        i.setMode(state.display);
        s.apply(state.section);
        l.setCfg(state.lighting);
      },
    });
    return () => registerViewState(null);
  }, [registerViewState]);
}
