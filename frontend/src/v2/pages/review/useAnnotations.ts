import { useState } from 'react';
import type { Shape, Tool } from '../../components/AnnotationCanvas';
import type { Hotspot3D, SplatLayoutAnim } from './reviewTypes';

/**
 * État de l'annotation du composer (dessin 2D + hotspot 3D) avec undo/redo,
 * et de l'annotation d'un commentaire sélectionné affichée en lecture seule
 * (`viewed*`, ratio du viewer capturé à l'enregistrement pour le 3D).
 *
 * `defaultColor` (14.F) = couleur attitrée de l'utilisateur (dérivée de l'id ou préférence
 * enregistrée). Elle sert de valeur active tant que l'utilisateur n'a pas choisi une couleur
 * manuellement (couleur **dérivée**, pas d'effet) ; `onColorChange` permet la persistance
 * côté appelant.
 */
export function useAnnotations(opts?: { defaultColor?: string; onColorChange?: (c: string) => void }) {
  const [tool, setTool] = useState<Tool>('draw');
  // Choix manuel prioritaire ; sinon couleur par défaut (préférence/id), rechargée sans effet.
  const [manualColor, setManualColor] = useState<string | null>(null);
  const color = manualColor ?? opts?.defaultColor ?? '#ef4444';
  const setColor = (c: string) => {
    setManualColor(c);
    opts?.onColorChange?.(c);
  };
  const [alpha, setAlpha] = useState(1);
  const [penWidth, setPenWidth] = useState(3);
  const [annot, setAnnot] = useState<Shape[]>([]);
  const [past, setPast] = useState<Shape[][]>([]);
  const [future, setFuture] = useState<Shape[][]>([]);
  const [annotating, setAnnotating] = useState(false);
  const [hotspot3d, setHotspot3d] = useState<Hotspot3D | null>(null);
  // Animation caméra jointe au commentaire en cours (mode layout) — staged avant envoi.
  const [cameraAnim, setCameraAnim] = useState<SplatLayoutAnim | null>(null);
  // Annotation d'un commentaire sélectionné (lecture seule)
  const [viewed, setViewed] = useState<Shape[] | null>(null);
  const [viewed3d, setViewed3d] = useState<Hotspot3D | null>(null);
  const [viewedAspect, setViewedAspect] = useState<number | null>(null);
  // Animation caméra du commentaire sélectionné — rejouée par le viewer.
  const [viewedCameraAnim, setViewedCameraAnim] = useState<SplatLayoutAnim | null>(null);

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
    setCameraAnim(null);
    setAnnotating(false);
  };

  /** Masque l'annotation du commentaire sélectionné. */
  const clearViewed = () => {
    setViewed(null);
    setViewed3d(null);
    setViewedAspect(null);
    setViewedCameraAnim(null);
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
    cameraAnim,
    setCameraAnim,
    viewed,
    setViewed,
    viewed3d,
    setViewed3d,
    viewedAspect,
    setViewedAspect,
    viewedCameraAnim,
    setViewedCameraAnim,
    resetComposer,
    clearViewed,
  };
}

export type Annotations = ReturnType<typeof useAnnotations>;
