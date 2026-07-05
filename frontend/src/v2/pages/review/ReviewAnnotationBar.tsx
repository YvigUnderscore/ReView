import { Crosshair, Pencil } from 'lucide-react';
import { AnnotationToolbar } from '../../components/AnnotationToolbar';
import type { useAnnotations } from './useAnnotations';

/** Barre d'outils d'annotation (activer/masquer, recentrer le hotspot 3D, palette). */
export default function ReviewAnnotationBar({
  ann,
  kind,
  onToggle,
  onClearSelection,
  onPlaceHotspot,
}: {
  ann: ReturnType<typeof useAnnotations>;
  kind?: string;
  onToggle: () => void;
  onClearSelection: () => void;
  onPlaceHotspot: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <button
        onClick={onToggle}
        className={`flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm ${ann.annotating ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary/60'}`}
      >
        <Pencil size={14} /> {ann.annotating ? 'Terminer l’annotation' : 'Annoter'}
      </button>
      {ann.viewed && (
        <button
          onClick={onClearSelection}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
        >
          Masquer l’annotation
        </button>
      )}
      {ann.annotating && kind === 'MODEL_3D' && (
        <button
          onClick={onPlaceHotspot}
          title="Replacer le hotspot au centre du viewer"
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
        >
          <Crosshair size={14} /> Recentrer le hotspot
        </button>
      )}
      {ann.annotating && (
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
      )}
    </div>
  );
}
