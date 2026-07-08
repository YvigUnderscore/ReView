import {
  Circle,
  Grip,
  Lasso,
  Maximize2,
  Move3d,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
  SquareDashedMousePointer,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RenderMode } from '../scene/renderModes';
import type { EditorTool } from './useSplatEditor';

/**
 * Barre d'outils de l'éditeur de splat (10.G) — style « logiciel 3D ». Groupe outils (gizmos
 * déplacer/tourner/échelle + sélection rectangle/lasso, raccourcis T/R/S/B/L), groupe
 * visualisation (splats / ellipses gaussiennes / points), compteur de sélection, enregistrer /
 * réinitialiser. Tokens de thème + icônes lucide, cohérent avec les autres toolbars de review.
 */
const TOOLS: { tool: EditorTool; icon: LucideIcon; label: string; hint: string }[] = [
  { tool: 'translate', icon: Move3d, label: 'Déplacer', hint: 'Déplacer le splat (T)' },
  { tool: 'rotate', icon: RotateCw, label: 'Tourner', hint: 'Faire pivoter le splat (R)' },
  { tool: 'scale', icon: Maximize2, label: 'Échelle', hint: "Mettre à l'échelle le splat (S)" },
  {
    tool: 'select-rect',
    icon: SquareDashedMousePointer,
    label: 'Rectangle',
    hint: 'Sélection rectangle (B) — Maj ajoute, Alt retire',
  },
  {
    tool: 'select-lasso',
    icon: Lasso,
    label: 'Lasso',
    hint: 'Sélection lasso (L) — Maj ajoute, Alt retire',
  },
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
  tool,
  onTool,
  renderMode,
  onRenderMode,
  selectedCount,
  onClearSelection,
  deletedCount,
  onDelete,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  dirty,
  busy,
  onSave,
  onReset,
}: {
  tool: EditorTool;
  onTool: (t: EditorTool) => void;
  renderMode: RenderMode;
  onRenderMode: (m: RenderMode) => void;
  selectedCount: number;
  onClearSelection: () => void;
  /** Splats masqués par la suppression non-destructive (0 = aucun). */
  deletedCount: number;
  onDelete: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-md border border-border bg-card/85 px-3 py-2 text-xs shadow-sm backdrop-blur">
      <div className="flex items-center gap-1 rounded-md bg-secondary/40 p-0.5">
        {TOOLS.map(({ tool: t, icon, label, hint }) => (
          <SegButton
            key={t}
            icon={icon}
            label={label}
            hint={hint}
            active={tool === t}
            onClick={() => onTool(t)}
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

      {selectedCount > 0 && (
        <span className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-muted-foreground">
          <span className="font-mono text-foreground">{selectedCount.toLocaleString('fr-FR')}</span>
          sélectionnés
          <button
            onClick={onClearSelection}
            title="Tout désélectionner"
            className="rounded p-0.5 hover:bg-secondary hover:text-foreground"
          >
            <X size={12} />
          </button>
        </span>
      )}

      {deletedCount > 0 && (
        <span className="rounded-md bg-secondary/40 px-2 py-1 text-muted-foreground">
          <span className="font-mono text-foreground">{deletedCount.toLocaleString('fr-FR')}</span> masqués
        </span>
      )}

      <div className="flex items-center gap-1">
        <button
          onClick={onDelete}
          disabled={selectedCount === 0}
          title="Supprimer la sélection (Suppr) — non-destructif, annulable"
          className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          <Trash2 size={13} /> Supprimer
        </button>
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Annuler (Ctrl+Z)"
          className="flex items-center justify-center rounded-md border border-border p-1.5 hover:bg-secondary/60 disabled:opacity-50"
        >
          <Undo2 size={13} />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Rétablir (Ctrl+Y)"
          className="flex items-center justify-center rounded-md border border-border p-1.5 hover:bg-secondary/60 disabled:opacity-50"
        >
          <Redo2 size={13} />
        </button>
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
