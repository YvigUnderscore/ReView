// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import type { ChromeState } from '../chrome/chromeState';
import type { ToolId } from '../chrome/tools';
import { useEditHistory } from '../splat/editor/operations/history';
import { useTransformGizmo } from '../viewer/gizmos/useTransformGizmo';
import type { TransformMode } from '../viewer/gizmos/useGizmoModeShortcuts';
import { IDENTITY_TRANSFORM } from './sceneOverride';
import { eulerTransformFromMesh } from './modelGizmoTransform';
import type { Model3DThreeState } from './useModel3DThree';
import { usePrimGizmo } from './usePrimGizmo';
import type { UsdSceneState } from './useUsdScene';
import { useT } from '../../../i18n';

/** Cible vide stable pour le gizmo par prim quand aucune scène USD n'est montée. */
const EMPTY_TARGETS = () => [];

/** Outils du rail sans implémentation dans le viewer 3D (le pinceau et la zone sont splat). */
export const MODEL_HIDDEN_TOOLS: ToolId[] = ['paint', 'region'];

/** Traduction rail → mode du gizmo TRS. */
const GIZMO_MODE: Partial<Record<ToolId, TransformMode>> = {
  translate: 'translate',
  rotate: 'rotate',
  scale: 'scale',
};

/**
 * Branche le rail sur le gizmo du modèle : l'outil armé décide du mode de transformation, et
 * chaque drag reste annulable. Reprend le montage qui vivait dans `Model3DTransformBar` —
 * seule la barre disparaît, l'historique et le gizmo sont inchangés.
 */
export function useModel3DChrome({
  state,
  m,
  cameraRig,
  usdScene,
}: {
  state: ChromeState;
  m: Model3DThreeState;
  cameraRig?: { mode: 'translate' | 'rotate'; setMode: (mode: 'translate' | 'rotate') => void };
  /** Scène USD : un prim sélectionné détourne le gizmo TRS vers ce prim (46.N). */
  usdScene?: UsdSceneState;
}) {
  const t = useT();
  const history = useEditHistory();
  const { updateTransform } = m;
  const mode: TransformMode = GIZMO_MODE[state.tool] ?? 'navigate';

  // Un prim USD sélectionné prend le gizmo : le delta est écrit dans l'override ReView (pas
  // dans la transformation de version), donc enregistrable pour tous avant publication et
  // joignable à un commentaire après. Sans sélection, le gizmo transforme le modèle entier.
  const primObject = usdScene?.selectedObject ?? null;

  useTransformGizmo(m, {
    enabled: mode !== 'navigate' && !primObject,
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
    enabled: mode !== 'navigate' && !!primObject,
    mode: mode === 'navigate' ? 'rotate' : mode,
    target: primObject,
    targets: usdScene?.selectedObjects ?? EMPTY_TARGETS,
    syncKey: usdScene?.override,
    // Pendant le drag, le proxy pilote la pose de l'objet ; le delta n'est relevé qu'au
    // lâcher, puis `applyPlan` le répercute sur tous les objets du prim.
    onCommit: (object) => {
      if (!usdScene) return;
      const commit = usdScene.commitPrimTransform(object);
      if (!commit) return;
      const { setPrim } = usdScene;
      history.push({
        label: t('model3d.transformPrim'),
        undo: () => setPrim(commit.path, { transform: commit.before ?? IDENTITY_TRANSFORM }),
        redo: () => setPrim(commit.path, { transform: commit.after }),
      });
    },
  });

  useEffect(() => {
    if (!cameraRig) return;
    if (state.tool === 'cam-move') cameraRig.setMode('translate');
    else if (state.tool === 'cam-aim') cameraRig.setMode('rotate');
  }, [state.tool, cameraRig]);

  // Ce qui dit si quelque chose est en attente, c'est l'édition locale de la transformation
  // pas encore poussée sur la version — l'enregistrement la relâche.
  return { history, dirty: m.tfDirty };
}
