import { Circle, Grip, Maximize2, Move3d, RotateCcw, RotateCw, Save, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RenderMode } from '../scene/renderModes';
import type { GizmoMode } from './gizmos/useTransformGizmo';

/**
 * Barre d'outils de l'éditeur de splat (10.G) — style « logiciel 3D ». Groupe outils (gizmo
 * déplacer/tourner/échelle, pilote le gizmo 3D visible dans la scène) + groupe visualisation
 * (splats / ellipses gaussiennes / points) + enregistrer/réinitialiser. Tokens de thème +
 * icônes lucide, cohérent avec les autres toolbars de review. S'étoffe aux chantiers suivants.
 */
const GIZMOS: { mode: GizmoMode; icon: LucideIcon; label: string; hint: string }[] = [
  { mode: 'translate', icon: Move3d, label: 'Déplacer', hint: 'Déplacer le splat' },
  { mode: 'rotate', icon: RotateCw, label: 'Tourner', hint: 'Faire pivoter le splat' },
  { mode: 'scale', icon: Maximize2, label: 'Échelle', hint: "Mettre à l'échelle le splat" },
];

const RENDER_MODES: { mode: RenderMode; icon: LucideIcon; label: string; hint: string }[] = [
  { mode: 'splats', icon: Sparkles, label: 'Splats', hint: 'Rendu gaussien (splats)' },
  { mode: 'ellipses', icon: Circle, label: 'Ellipses', hint: 'Ellipses gaussiennes pleines' },
  { mode: 'points', icon: Grip, label: 'Points', hint: 'Nuage de points (centres)' },
];

/** Bouton segmenté générique (défini au niveau module, pas dans le render). */
function SegButton({
  icon: Icon,
  label,
  active,
  hint,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded px-2 py-1 font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      <Icon size={13} /> {label}
    </button>
  );
}

export default function SplatEditorToolbar({
  gizmoMode,
  onGizmoMode,
  renderMode,
  onRenderMode,
  dirty,
  busy,
  onSave,
  onReset,
}: {
  gizmoMode: GizmoMode;
  onGizmoMode: (m: GizmoMode) => void;
  renderMode: RenderMode;
  onRenderMode: (m: RenderMode) => void;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
      <div className="flex items-center gap-1 rounded-md bg-secondary/40 p-0.5">
        {GIZMOS.map(({ mode, icon, label, hint }) => (
          <SegButton
            key={mode}
            icon={icon}
            label={label}
            hint={hint}
            active={gizmoMode === mode}
            onClick={() => onGizmoMode(mode)}
          />
        ))}
      </div>

      <div className="flex items-center gap-1 rounded-md bg-secondary/40 p-0.5">
        {RENDER_MODES.map(({ mode, icon, label, hint }) => (
          <SegButton
            key={mode}
            icon={icon}
            label={label}
            hint={hint}
            active={renderMode === mode}
            onClick={() => onRenderMode(mode)}
          />
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={busy || !dirty}
          className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
        >
          <Save size={13} /> Enregistrer
        </button>
        <button
          onClick={onReset}
          disabled={busy}
          title="Réinitialiser la transformation"
          className="flex items-center justify-center rounded-md border border-border p-1.5 hover:bg-secondary/60 disabled:opacity-50"
        >
          <RotateCcw size={13} />
        </button>
      </div>
    </div>
  );
}
