import { useState } from 'react';
import { Move3d, RotateCcw, Rotate3d, Save, Scaling } from 'lucide-react';
import { DEFAULT_TRANSFORM } from './reviewTypes';
import { HudGroup, HudIconButton } from './hud/ViewerHud';
import HudNumber from './hud/HudNumber';
import { useTransformGizmo, type GizmoMode } from './viewer/gizmos/useTransformGizmo';
import type { Model3DThreeState } from './three/useModel3DThree';
import { eulerTransformFromMesh } from './three/modelGizmoTransform';

/**
 * Édition de la transformation du modèle 3D pré-publish (Phase 17) : gizmo TRS **visible dans la
 * scène** (rotation/échelle — la translation n'est pas persistée par `version.transform`) greffé
 * sur le groupe du modèle, plus des champs numériques « drag-label ». Remplace les anciens
 * sliders yaw/pitch/roll/échelle. Le gizmo écrit la rotation (quaternion→euler) et l'échelle
 * uniforme via `updateTransform`.
 */
export default function Model3DTransformBar({ m }: { m: Model3DThreeState }) {
  const [mode, setMode] = useState<Extract<GizmoMode, 'rotate' | 'scale'>>('rotate');

  useTransformGizmo(m, {
    enabled: true,
    mode,
    onChange: (trs) => m.updateTransform(eulerTransformFromMesh(trs)),
  });

  const t = m.transform;
  return (
    <HudGroup>
      <Move3d size={14} className="text-muted-foreground" />
      <HudIconButton
        icon={Rotate3d}
        hint="Tourner (gizmo)"
        active={mode === 'rotate'}
        onClick={() => setMode('rotate')}
      />
      <HudIconButton
        icon={Scaling}
        hint="Mettre à l'échelle (gizmo)"
        active={mode === 'scale'}
        onClick={() => setMode('scale')}
      />
      <span className="h-4 w-px bg-border" />
      <HudNumber
        label="X°"
        hint="Rotation X (pitch)"
        value={Math.round(t.pitch)}
        onChange={(pitch) => m.updateTransform({ pitch })}
        min={-180}
        max={180}
        step={1}
      />
      <HudNumber
        label="Y°"
        hint="Rotation Y (yaw)"
        value={Math.round(t.yaw)}
        onChange={(yaw) => m.updateTransform({ yaw })}
        min={-180}
        max={180}
        step={1}
      />
      <HudNumber
        label="Z°"
        hint="Rotation Z (roll)"
        value={Math.round(t.roll)}
        onChange={(roll) => m.updateTransform({ roll })}
        min={-180}
        max={180}
        step={1}
      />
      <HudNumber
        label="Éch."
        hint="Échelle uniforme"
        value={Number(t.scale.toFixed(2))}
        onChange={(scale) => m.updateTransform({ scale: Math.max(scale, 0.1) })}
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
        onClick={() => m.updateTransform(DEFAULT_TRANSFORM)}
      />
    </HudGroup>
  );
}
