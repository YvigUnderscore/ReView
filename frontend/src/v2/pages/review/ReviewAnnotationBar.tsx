import { Crosshair } from 'lucide-react';
import { AnnotationToolbar } from '../../components/AnnotationToolbar';
import type { useAnnotations } from './useAnnotations';

/**
 * Bouton « Masquer l'annotation » affiché au-dessus du viewer quand l'annotation d'un
 * commentaire est visible. Les outils de dessin vivent sous le champ de commentaire
 * (`AnnotationTools`, activés par « Annoter » — Phase 24).
 */
export default function ReviewAnnotationBar({
  ann,
  onClearSelection,
}: {
  ann: ReturnType<typeof useAnnotations>;
  onClearSelection: () => void;
}) {
  if (!ann.viewed) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <button
        onClick={onClearSelection}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
      >
        Masquer l’annotation
      </button>
    </div>
  );
}

/**
 * Outils d'annotation (palette + recentrage du hotspot 3D), rendus sous l'espace
 * commentaire quand le mode annotation est actif.
 */
export function AnnotationTools({
  ann,
  kind,
  onPlaceHotspot,
}: {
  ann: ReturnType<typeof useAnnotations>;
  kind?: string;
  onPlaceHotspot: () => void;
}) {
  if (!ann.annotating) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(kind === 'MODEL_3D' || kind === 'SPLAT') && (
        <button
          type="button"
          onClick={onPlaceHotspot}
          title="Replacer le hotspot au centre du viewer"
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
        >
          <Crosshair size={14} /> Recentrer le hotspot
        </button>
      )}
      <AnnotationToolbar
        tool={ann.tool}
        setTool={ann.setTool}
        color={ann.color}
        setColor={ann.setColor}
        width={ann.penWidth}
        setWidth={ann.setPenWidth}
        alpha={ann.alpha}
        setAlpha={ann.setAlpha}
        onUndo={ann.undo}
        onRedo={ann.redo}
        onClear={ann.clear}
        canUndo={ann.canUndo}
        canRedo={ann.canRedo}
      />
    </div>
  );
}
