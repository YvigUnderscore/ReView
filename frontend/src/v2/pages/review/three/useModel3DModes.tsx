// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { ChromeState } from '../chrome/chromeState';
import { DEFAULT_MODE, type ModeId, type ReviewMode } from '../chrome/modes';
import type { ReviewTool } from '../chrome/tools';
import { useChromeState } from '../chrome/useChromeState';
import { useSpatialAnnotate } from '../chrome/useSpatialAnnotate';
import SurfaceBrushLayer from '../splat/paint/SurfaceBrushLayer';
import type { SplatPaintState } from '../splat/paint/useSplatPaint';
import type { Annotations } from '../useAnnotations';
import type { Model3DThreeState } from './useModel3DThree';
import {
  canCleanModel3d,
  model3dSwitcherModes,
  model3dToolsFor,
  type Model3DCleanReach,
} from './model3dChrome';

/**
 * Chrome of the 3D model viewer: the switcher and the rail this media actually offers, the tool
 * armed from it, and the two direct consequences of that tool on the scene — the layer of the
 * surface brush and the camera workshop. Twin of `splat/useSplatView`.
 *
 * The generic hook (`useChromeState`) accepts both lists; they are computed here, once, so that the
 * header switcher, the number keys, the rail and the tool letters all read the same source. Without
 * this uniqueness, a mode removed from the header stayed armable from the keyboard — the dead button
 * came back through the service door.
 *
 * `reach` says where the gizmos of the "Clean" mode can write: the version transform (right granted
 * by the server) or the USD scene override. Without either, the mode only offers a refused save — it
 * disappears.
 *
 * The flight guard comes from the viewer (`isFlying`): right click held = navigation mode, where no
 * letter arms a tool (`S`, moving backward with ZQSD as with WASD, armed the scale gizmo).
 */
export interface Model3DChromeView {
  /** Chrome state (mode, tool, panel, drawer) and its patcher — persisted preferences. */
  state: ChromeState;
  update: (patch: Partial<ChromeState>) => void;
  /** Switcher actually offered — the SAME list for the header and for the number keys. */
  modes: ReviewMode[];
  /** Rail tools for the current mode. */
  tools: ReviewTool[];
  /** Armed tool resolved in the current mode (fallback: first tool of the mode). */
  activeTool: ReviewTool;
  /** Layer of the surface brush — `null` as long as neither of its two tools is armed. */
  brushLayer: ReactNode;
}

export function useModel3DModes(
  reach: Model3DCleanReach,
  m: Model3DThreeState,
  /** Ongoing annotation and surface brush: what the armed tool drives outside the chrome. */
  annotation: { ann: Annotations; paint: SplatPaintState },
): Model3DChromeView {
  const { canEditTransform, hasScenegraph } = reach;
  const { isFlying, setLayoutMode, getDom, ready } = m;
  const canClean = useMemo(
    () => canCleanModel3d({ canEditTransform, hasScenegraph }),
    [canEditTransform, hasScenegraph],
  );
  const modes = useMemo(() => model3dSwitcherModes(canClean), [canClean]);
  const toolsOf = useCallback((mode: ModeId) => model3dToolsFor(mode, canClean), [canClean]);
  const { state, update } = useChromeState('MODEL_3D', { modes, tools: toolsOf, isFlying });

  // The right to write the transform can fall from under the user's feet (version published by a
  // manager during the session): we do not leave them in a mode whose segment has just disappeared,
  // manipulating gizmos that will not save.
  useEffect(() => {
    if (!canClean && state.mode === 'clean') update({ mode: DEFAULT_MODE });
  }, [canClean, state.mode, update]);

  // "Annotate" button of the composer ↔ "Annotate" mode of the rail: without this bridge, clicking
  // "Annotate" on a model only armed the 2D pencil and the scene tools stayed invisible.
  useSpatialAnnotate({ state, update, ann: annotation.ann });

  // Staging mode = camera workshop: entering it takes the camera out of the plan, leaving it puts
  // it back. Sole write of the "in / out of camera" — model at the head of `viewer/useLayoutMode`.
  useEffect(() => {
    setLayoutMode(state.mode === 'stage');
  }, [state.mode, setLayoutMode]);

  const tools = toolsOf(state.mode);
  return {
    state,
    update,
    modes,
    tools,
    activeTool: tools.find((tool) => tool.id === state.tool) ?? tools[0],
    brushLayer: <SurfaceBrushLayer paint={annotation.paint} ready={ready} getCanvas={getDom} />,
  };
}
