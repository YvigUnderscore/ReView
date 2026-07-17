import { useEffect } from 'react';
import { Crosshair, EyeOff } from 'lucide-react';
import { AnnotationToolbar } from '../../components/AnnotationToolbar';
import type { useAnnotations } from './useAnnotations';

/**
 * Pilule flottante « Masquer l'annotation », affichée **sur le viewer** (haut, centrée)
 * quand l'annotation d'un commentaire est visible — accessible sans quitter l'image des
 * yeux, fermable aussi avec Échap. Les outils de dessin vivent sous le champ de
 * commentaire (`AnnotationTools`, activés par « Annoter » — Phase 24).
 */
export default function ReviewAnnotationBar({
  ann,
  onClearSelection,
}: {
  ann: ReturnType<typeof useAnnotations>;
  onClearSelection: () => void;
}) {
  const visible = !!ann.viewed;
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClearSelection]);

  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2">
      <button
        onClick={onClearSelection}
        title="Masquer l'annotation affichée (Échap)"
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-sm shadow-lg backdrop-blur hover:bg-secondary"
      >
        <EyeOff size={14} /> Masquer l’annotation
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
