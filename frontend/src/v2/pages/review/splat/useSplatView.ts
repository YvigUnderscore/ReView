// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeAnim } from '../camera/channels/model';
import type { ChromeState } from '../chrome/chromeState';
import { DEFAULT_MODE, type ModeId, type ReviewMode } from '../chrome/modes';
import { toolsFor, type RailSection, type ReviewTool } from '../chrome/tools';
import { useChromeState } from '../chrome/useChromeState';
import type { MediaResp } from '../reviewTypes';
import type { EditorTool } from './editor/useSplatEditor';
import type { PresentationState } from './presentation/usePresentation';
import { readCullingOff, writeCullingOff } from './scene/cullingDefault';
import { splatEditRail, splatSwitcherModes, splatToolsFor } from './splatChrome';
import type { SplatViewer } from './useSplat';

/** Armed selection trace in the overlay anchored to the view (null: no trace in progress). */
export type SplatSelectTool = 'rect' | 'lasso' | 'brush';

/**
 * Splat toggle: fixed list, computed once. It only carries translation **keys**, never a
 * translated label: nothing freezes the language at load time. Keeping it stable avoids
 * re-registering the chrome's keyboard handler on every render.
 */
const SWITCHER_MODES = splatSwitcherModes();

export interface SplatViewState {
  /** Chrome state (mode, tool, panel, drawer) and its patcher: persisted preferences. */
  state: ChromeState;
  update: (patch: Partial<ChromeState>) => void;
  /**
   * Toggle really offered: the SAME list for the header and the number keys.
   * Without this uniqueness, a segment removed from the header would stay armable from the keyboard.
   */
  modes: ReviewMode[];
  /** Panel culling switch: preference remembered per user. */
  culling: { off: boolean; onOff: (off: boolean) => void };
  /** Armed tool resolved in the current mode (fallback: first tool of the mode). */
  activeTool: ReviewTool;
  /**
   * Second rail group: the cloud's editing tools, moved to the left in lot 13. Absent
   * without a mounted editor, and the same absence applies to the keyboard (`splatToolsFor`).
   */
  railExtra?: RailSection;
  /** Selection trace to arm in the overlay, deduced from the editor tool. */
  selectTool: SplatSelectTool | null;
  /** The camera animation differs from the persisted presentation ("Save" button). */
  animDirty: boolean;
}

/**
 * Splat view state: chrome (mode, tool, panel), culling, mapping of the armed tool to the
 * selection trace, and the gap between the current animation and the persisted presentation.
 * Extracted from `SplatReview` (line budget): nothing here touches the Three scene, except the
 * culling switch, which drives it through the viewer's handle.
 */
export function useSplatView({
  splat,
  data,
  pres,
  editorTool,
  showEdit,
}: {
  splat: SplatViewer;
  data: MediaResp;
  pres: PresentationState;
  /** Current tool of the splat editor (the trace overlay depends on it). */
  editorTool: EditorTool;
  /** Editor mounted: without it, the editing tools are neither on the rail nor on the keyboard. */
  showEdit: boolean;
}): SplatViewState {
  // Flight guard: right button held means navigation mode, the keyboard belongs to the flight and
  // no tool letter arms a gizmo (`S` used to arm Scale while reversing).
  //
  // `modes` is the switch the splat REALLY offers: "Staging" and "Clean up" have left it
  // (cf. `splatChrome`): only "Explore" remains, so the switch disappears. The number keys
  // read the same list: a segment absent from the header cannot be armed from the keyboard.
  // The tool LETTERS, for their part, keep leading to both modes, and to them alone:
  // `toolsOf` is the SAME list as the rail's, editor absence included, so no letter arms a tool
  // that is nowhere on screen.
  const toolsOf = useCallback((mode: ModeId) => splatToolsFor(mode, showEdit), [showEdit]);
  const { state, update } = useChromeState('SPLAT', {
    modes: SWITCHER_MODES,
    tools: toolsOf,
    isFlying: splat.isFlying,
  });
  // Spark culling active by default, unless the user prefers otherwise: remembered per user.
  const [cullingOff, setCullingOffState] = useState(readCullingOff);
  const onCullingOff = useCallback(
    (off: boolean) => {
      setCullingOffState(off);
      writeCullingOff(off);
      splat.setCullingOff(off);
    },
    [splat],
  );

  // Staging mode = camera workshop: entering the mode takes the camera off the plan (PiP and
  // camera-object), leaving it puts it back. **The only write** of the layout mode on the splat side
  // since Phase 50: the Camera panel toggle drives `state.mode`, as in 3D, instead of calling
  // `setLayoutMode` in parallel (two sources of truth that could diverge).
  const { setLayoutMode } = pres.layout;
  useEffect(() => {
    setLayoutMode(state.mode === 'stage');
  }, [state.mode, setLayoutMode]);

  // "Not saved" = the animation differs from the persisted presentation, and no longer "an
  // animation exists" (which stayed dirty forever, even just after publishing).
  const savedAnimJson = useMemo(
    () => JSON.stringify(normalizeAnim(data.splatPresentation?.cameraAnim)),
    [data.splatPresentation],
  );
  const animDirty = pres.anim.hasAnimation && JSON.stringify(pres.anim.anim) !== savedAnimJson;

  const selectTool: SplatSelectTool | null =
    editorTool === 'select-rect'
      ? 'rect'
      : editorTool === 'select-lasso'
        ? 'lasso'
        : editorTool === 'brush'
          ? 'brush'
          : null;

  // Two-step fallback: the first tool of the mode, else the one of the default mode. "Clean up"
  // without a mounted editor has no tool, and the options bar needs a descriptor.
  const modeTools = toolsOf(state.mode);
  const activeTool =
    modeTools.find((tool) => tool.id === state.tool) ?? modeTools[0] ?? toolsFor(DEFAULT_MODE, 'SPLAT')[0];

  return {
    state,
    update,
    modes: SWITCHER_MODES,
    culling: { off: cullingOff, onOff: onCullingOff },
    activeTool,
    railExtra: splatEditRail(showEdit),
    selectTool,
    animDirty,
  };
}
