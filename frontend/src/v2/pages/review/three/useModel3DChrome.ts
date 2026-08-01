import { useEffect } from 'react';
import type { ChromeState } from '../chrome/chromeState';
import type { ToolId } from '../chrome/tools';
import { useEditHistory } from '../splat/editor/operations/history';
import { useTransformGizmo } from '../viewer/gizmos/useTransformGizmo';
import type { TransformMode } from '../viewer/gizmos/useGizmoModeShortcuts';
import { eulerTransformFromMesh } from './modelGizmoTransform';
import type { Model3DThreeState } from './useModel3DThree';

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
}: {
  state: ChromeState;
  m: Model3DThreeState;
  cameraRig?: { mode: 'translate' | 'rotate'; setMode: (mode: 'translate' | 'rotate') => void };
}) {
  const history = useEditHistory();
  const { updateTransform } = m;
  const mode: TransformMode = GIZMO_MODE[state.tool] ?? 'navigate';

  useTransformGizmo(m, {
    enabled: mode !== 'navigate',
    mode: mode === 'navigate' ? 'rotate' : mode,
    onChange: (trs) => updateTransform(eulerTransformFromMesh(trs)),
    onCommit: (before, after) => {
      const b = eulerTransformFromMesh(before);
      const a = eulerTransformFromMesh(after);
      history.push({
        label: 'Transformer le modèle',
        undo: () => updateTransform(b),
        redo: () => updateTransform(a),
      });
    },
  });

  useEffect(() => {
    if (!cameraRig) return;
    if (state.tool === 'cam-move') cameraRig.setMode('translate');
    else if (state.tool === 'cam-aim') cameraRig.setMode('rotate');
  }, [state.tool, cameraRig]);

  // `savedTf` est posé par le hook du viewer à l'enregistrement de la transformation.
  return { history, dirty: !m.savedTf };
}
