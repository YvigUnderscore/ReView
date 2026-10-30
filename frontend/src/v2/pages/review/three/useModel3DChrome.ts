// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import type { ChromeState } from '../chrome/chromeState';
import type { ToolId } from '../chrome/tools';
import { useEditHistory } from '../splat/editor/operations/history';
import type { SplatPaintState } from '../splat/paint/useSplatPaint';
import { useTransformGizmo, type TransformMode } from '../viewer/gizmos/useTransformGizmo';
import { eulerTransformFromMesh } from './modelGizmoTransform';
import type { Model3DThreeState } from './useModel3DThree';
import { usePrimGizmo } from './usePrimGizmo';
import type { UsdSceneState } from './useUsdScene';
import { useT } from '@/v2/i18n';

/** Stable empty target for the per-prim gizmo when no USD scene is mounted. */
const EMPTY_TARGETS = () => [];

/** Translation rail → TRS gizmo mode. */
const GIZMO_MODE: Partial<Record<ToolId, TransformMode>> = {
  translate: 'translate',
  rotate: 'rotate',
  scale: 'scale',
};

/**
 * Wires the rail to the hooks that actually carry the gesture: the model's gizmo (the armed tool
 * decides the transform mode, and each drag stays undoable) and the surface brush. Takes over the
 * wiring that lived in `Model3DTransformBar` — only the bar disappears; history and gizmo are
 * unchanged. Twin of `splat/useSplatChrome`.
 */
export function useModel3DChrome({
  state,
  m,
  paint,
  cameraRig,
  usdScene,
}: {
  state: ChromeState;
  m: Model3DThreeState;
  /**
   * Surface brush — the SAME hook as the splat since batch 13. The rail says which of the two tools
   * is armed; the painting hook deduces what the click does.
   */
  paint: SplatPaintState;
  cameraRig?: { mode: 'translate' | 'rotate'; setMode: (mode: 'translate' | 'rotate') => void };
  /** USD scene: a selected prim diverts the TRS gizmo to that prim (46.N). */
  usdScene?: UsdSceneState;
}) {
  const t = useT();
  const history = useEditHistory();
  const { updateTransform } = m;
  const mode: TransformMode = GIZMO_MODE[state.tool] ?? 'navigate';

  // Selected USD prims take over the gizmo: the delta is written into the ReView override (not into
  // the version transform), hence savable for everyone before publication and attachable to a
  // comment afterwards. Without a selection, the gizmo transforms the whole model.
  const primSelection = usdScene?.selected ?? [];
  const hasPrims = primSelection.length > 0 && !!usdScene?.selectedObject;

  useTransformGizmo(m, {
    enabled: mode !== 'navigate' && !hasPrims,
    mode: mode === 'navigate' ? 'rotate' : mode,
    onChange: (trs) => updateTransform(eulerTransformFromMesh(trs)),
    onCommit: (before, after) => {
      const b = eulerTransformFromMesh(before);
      const a = eulerTransformFromMesh(after);
      history.push({
        label: t('model3d.transformModel'),
        undo: () => updateTransform(b),
        redo: () => updateTransform(a),
      });
    },
  });

  usePrimGizmo(m, {
    enabled: mode !== 'navigate' && hasPrims,
    mode: mode === 'navigate' ? 'rotate' : mode,
    representatives: usdScene?.representatives ?? EMPTY_TARGETS,
    targets: usdScene?.selectedObjects ?? EMPTY_TARGETS,
    selectionKey: primSelection.join('|'),
    syncKey: usdScene?.override,
    // During the drag, the proxy drives the representatives' pose; the deltas are only read on
    // release (a single batch), then `applyPlan` propagates them to all objects of the prims.
    onCommit: (objects) => {
      if (!usdScene) return;
      const commits = usdScene.commitPrimTransforms(objects);
      if (!commits.length) return;
      const { applyPrimTransform } = usdScene;
      history.push({
        label: t('model3d.transformPrim'),
        undo: () => {
          for (const c of commits) applyPrimTransform(c.path, c.before);
        },
        redo: () => {
          for (const c of commits) applyPrimTransform(c.path, c.after);
        },
      });
    },
  });

  const { setArmed } = paint;
  useEffect(() => {
    setArmed(state.tool === 'paint' ? 'paint' : state.tool === 'paint-erase' ? 'erase' : null);
  }, [state.tool, setArmed]);

  useEffect(() => {
    if (!cameraRig) return;
    if (state.tool === 'cam-move') cameraRig.setMode('translate');
    else if (state.tool === 'cam-aim') cameraRig.setMode('rotate');
  }, [state.tool, cameraRig]);

  // What tells whether something is pending is the local edit of the transform, not yet pushed to
  // the version — saving releases it.
  return { history, dirty: m.tfDirty };
}
