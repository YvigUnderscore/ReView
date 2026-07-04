import { useState } from 'react';
import type { Shape, Tool } from '../../components/AnnotationCanvas';
import type { Hotspot3D } from './reviewTypes';

/**
 * État de l'annotation du composer (dessin 2D + hotspot 3D) avec undo/redo,
 * et de l'annotation d'un commentaire sélectionné affichée en lecture seule
 * (`viewed*`, ratio du viewer capturé à l'enregistrement pour le 3D).
 */
export function useAnnotations() {
  const [tool, setTool] = useState<Tool>('draw');
  const [color, setColor] = useState('#ef4444');
  const [alpha, setAlpha] = useState(1);
  const [penWidth, setPenWidth] = useState(3);
  const [annot, setAnnot] = useState<Shape[]>([]);
  const [past, setPast] = useState<Shape[][]>([]);
  const [future, setFuture] = useState<Shape[][]>([]);
  const [annotating, setAnnotating] = useState(false);
  const [hotspot3d, setHotspot3d] = useState<Hotspot3D | null>(null);
  // Annotation d'un commentaire sélectionné (lecture seule)
  const [viewed, setViewed] = useState<Shape[] | null>(null);
  const [viewed3d, setViewed3d] = useState<Hotspot3D | null>(null);
  const [viewedAspect, setViewedAspect] = useState<number | null>(null);

  const setShapes = (next: Shape[]) => {
    setPast((p) => [...p, annot]);
    setFuture([]);
    setAnnot(next);
  };
  const undo = () =>
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1]!;
      setFuture((f) => [annot, ...f]);
      setAnnot(prev);
      return p.slice(0, -1);
    });
  const redo = () =>
    setFuture((f) => {
      if (!f.length) return f;
      const nx = f[0]!;
      setPast((p) => [...p, annot]);
      setAnnot(nx);
      return f.slice(1);
    });
  const clear = () => setShapes([]);

  /** Réinitialise le composer (après envoi du commentaire). */
  const resetComposer = () => {
    setAnnot([]);
    setPast([]);
    setFuture([]);
    setHotspot3d(null);
    setAnnotating(false);
  };

  /** Masque l'annotation du commentaire sélectionné. */
  const clearViewed = () => {
    setViewed(null);
    setViewed3d(null);
    setViewedAspect(null);
  };

  return {
    tool,
    setTool,
    color,
    setColor,
    alpha,
    setAlpha,
    penWidth,
    setPenWidth,
    annot,
    setShapes,
    undo,
    redo,
    clear,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    annotating,
    setAnnotating,
    hotspot3d,
    setHotspot3d,
    viewed,
    setViewed,
    viewed3d,
    setViewed3d,
    viewedAspect,
    setViewedAspect,
    resetComposer,
    clearViewed,
  };
}

export type Annotations = ReturnType<typeof useAnnotations>;
