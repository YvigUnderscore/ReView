import { useState } from 'react';
import { MousePointer2, Move3d, Redo2, RotateCcw, Rotate3d, Save, Scaling, Undo2 } from 'lucide-react';
import { DEFAULT_TRANSFORM } from './reviewTypes';
import { HudGroup, HudIconButton } from './hud/ViewerHud';
import HudNumber from './hud/HudNumber';
import { useTransformGizmo } from './viewer/gizmos/useTransformGizmo';
import { useGizmoModeShortcuts, type TransformMode } from './viewer/gizmos/useGizmoModeShortcuts';
import { useEditHistory } from './splat/editor/operations/history';
import type { Model3DThreeState } from './three/useModel3DThree';
import { eulerTransformFromMesh } from './three/modelGizmoTransform';

/**
 * Édition de la transformation du modèle 3D pré-publish (Phase 17/26) : gizmo TRS **visible dans
 * la scène** greffé sur le groupe du modèle, avec **modes unifiés avec le splat** — navigation
 * (défaut), déplacer, tourner, mettre à l'échelle (raccourcis V/T/R/S, Échap → navigation). Le
 * gizmo écrit la rotation (quaternion→euler) et l'échelle uniforme via `updateTransform` ; chaque
 * drag est **annulable** (Ctrl+Z/Y/Maj+Z). Les champs « drag-label » complètent la saisie fine.
 */
export default function Model3DTransformBar({ m }: { m: Model3DThreeState }) {
  const [mode, setMode] = useState<TransformMode>('navigate');
  const history = useEditHistory();
  const { updateTransform } = m;

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
  useGizmoModeShortcuts({ enabled: true, isFlying: m.isFlying, setMode, history });

  const t = m.transform;
  return (
    <HudGroup>
      <HudIconButton
        icon={MousePointer2}
        hint="Naviguer (V) — orbite/pan"
        active={mode === 'navigate'}
        onClick={() => setMode('navigate')}
      />
      <HudIconButton
        icon={Move3d}
        hint="Déplacer (T)"
        active={mode === 'translate'}
        onClick={() => setMode('translate')}
      />
      <HudIconButton
        icon={Rotate3d}
        hint="Tourner (R)"
        active={mode === 'rotate'}
        onClick={() => setMode('rotate')}
      />
      <HudIconButton
        icon={Scaling}
        hint="Mettre à l'échelle (S)"
        active={mode === 'scale'}
        onClick={() => setMode('scale')}
      />
      <span className="h-4 w-px bg-border" />
      <HudIconButton
        icon={Undo2}
        hint="Annuler (Ctrl+Z)"
        onClick={history.undo}
        disabled={!history.canUndo}
      />
      <HudIconButton
        icon={Redo2}
        hint="Rétablir (Ctrl+Y)"
        onClick={history.redo}
        disabled={!history.canRedo}
      />
      <span className="h-4 w-px bg-border" />
      <HudNumber
        label="X°"
        hint="Rotation X (pitch)"
        value={Math.round(t.pitch)}
        onChange={(pitch) => updateTransform({ pitch })}
        min={-180}
        max={180}
        step={1}
      />
      <HudNumber
        label="Y°"
        hint="Rotation Y (yaw)"
        value={Math.round(t.yaw)}
        onChange={(yaw) => updateTransform({ yaw })}
        min={-180}
        max={180}
        step={1}
      />
      <HudNumber
        label="Z°"
        hint="Rotation Z (roll)"
        value={Math.round(t.roll)}
        onChange={(roll) => updateTransform({ roll })}
        min={-180}
        max={180}
        step={1}
      />
      <HudNumber
        label="Éch."
        hint="Échelle uniforme"
        value={Number(t.scale.toFixed(2))}
        onChange={(scale) => updateTransform({ scale: Math.max(scale, 0.1) })}
        min={0.1}
        max={5}
        step={0.05}
        pixelsPerStep={6}
      />
      <span className="h-4 w-px bg-border" />
      <button
        onClick={m.saveTransform}
        className="flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground"
      >
        <Save size={13} /> {m.savedTf ? 'Enregistré' : 'Enregistrer'}
      </button>
      <HudIconButton
        icon={RotateCcw}
        hint="Réinitialiser la transformation"
        onClick={() => updateTransform(DEFAULT_TRANSFORM)}
      />
    </HudGroup>
  );
}
