import { Maximize2, Move3d, RotateCcw, RotateCw, Save } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { GizmoMode } from './gizmos/useTransformGizmo';

/**
 * Barre d'outils de l'éditeur de splat (10.G) — style « logiciel 3D ». Segmenté déplacer /
 * tourner / mettre à l'échelle (pilote le gizmo 3D visible dans la scène) + enregistrer /
 * réinitialiser. Tokens de thème + icônes lucide, cohérent avec les autres toolbars de review.
 * S'étoffe aux chantiers suivants (sélection, volumes, modes de visualisation).
 */
const GIZMOS: { mode: GizmoMode; icon: LucideIcon; label: string; hint: string }[] = [
  { mode: 'translate', icon: Move3d, label: 'Déplacer', hint: 'Déplacer le splat' },
  { mode: 'rotate', icon: RotateCw, label: 'Tourner', hint: 'Faire pivoter le splat' },
  { mode: 'scale', icon: Maximize2, label: 'Échelle', hint: "Mettre à l'échelle le splat" },
];

export default function SplatEditorToolbar({
  gizmoMode,
  onGizmoMode,
  dirty,
  busy,
  onSave,
  onReset,
}: {
  gizmoMode: GizmoMode;
  onGizmoMode: (m: GizmoMode) => void;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
      <div className="flex items-center gap-1 rounded-md bg-secondary/40 p-0.5">
        {GIZMOS.map(({ mode, icon: Icon, label, hint }) => {
          const active = gizmoMode === mode;
          return (
            <button
              key={mode}
              onClick={() => onGizmoMode(mode)}
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
        })}
      </div>

      <span className="ml-1 text-muted-foreground">Gizmo 3D dans la vue — glissez les poignées</span>

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
