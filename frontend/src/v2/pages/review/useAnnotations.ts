// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef, useState } from 'react';
import type { Shape, Tool } from '../../components/AnnotationCanvas';
import {
  EMPTY_HISTORY,
  pushStep,
  redoStep,
  undoStep,
  type AnnotationHistory,
  type AnnotationSnapshot,
} from './annotationHistory';
import { clampRefBox, NO_BANDS, pastedRefBox, type StagedReference, type ViewerBands } from './referenceBox';
import { useAnnotationShortcuts } from './useAnnotationShortcuts';
import type { Hotspot3D, SplatLayoutAnim } from './reviewTypes';

/**
 * État de l'annotation du composer (dessin 2D, hotspot 3D, références collées) et de
 * l'annotation d'un commentaire sélectionné, lue seule (`viewed*`).
 *
 * Un seul historique couvre le dessin et les références, au clavier comme aux boutons.
 * `defaultColor` (couleur attitrée) reste active tant qu'aucune couleur n'est choisie à la main.
 */
export function useAnnotations(opts?: {
  defaultColor?: string;
  onColorChange?: (c: string) => void;
  /** Formes initiales du composer (initialiseur paresseux — brouillon local 32.C). */
  initialShapes?: () => Shape[];
}) {
  const [tool, setToolState] = useState<Tool>('draw');
  // Outil de tracé d'avant l'armement de la référence : y revenir est la sortie du mode pose.
  const drawTool = useRef<Tool>('draw');
  // Identité stable : le rail réarme son outil dans un effet dont `setTool` est une
  // dépendance — un nouveau `setTool` à chaque render y écraserait `ref` aussitôt posé.
  const setTool = useCallback((next: Tool) => {
    if (next !== 'ref') drawTool.current = next;
    setToolState(next);
  }, []);
  const exitRefTool = useCallback(() => setTool(drawTool.current), [setTool]);
  // Choix manuel prioritaire ; sinon couleur par défaut (préférence/id), rechargée sans effet.
  const [manualColor, setManualColor] = useState<string | null>(null);
  const color = manualColor ?? opts?.defaultColor ?? '#ef4444';
  const setColor = (c: string) => {
    setManualColor(c);
    opts?.onColorChange?.(c);
  };
  const [alpha, setAlpha] = useState(1);
  const [penWidth, setPenWidth] = useState(3);
  const [annot, setAnnot] = useState<Shape[]>(opts?.initialShapes ?? []);
  const [hist, setHist] = useState<AnnotationHistory>(EMPTY_HISTORY);
  // Geste en cours : tous les changements qui le portent tiennent dans un seul cran.
  const step = useRef<string | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [hotspot3d, setHotspot3d] = useState<Hotspot3D | null>(null);
  // Images de référence en préparation : posées/déplaçables tant que le commentaire n'est
  // pas envoyé, puis figées côté serveur (liées au commentaire créé).
  const [stagedRefs, setStagedRefs] = useState<StagedReference[]>([]);
  // Bandes libres autour du média, publiées par le calque des références (seul à connaître la
  // géométrie du viewer). Dans une `ref` : le placement au collage et le bornage du déplacement
  // les lisent au moment du geste, et une remesure ne doit pas relancer un rendu du composer.
  const refBands = useRef<ViewerBands>(NO_BANDS);
  const setRefBands = useCallback((bands: ViewerBands) => {
    refBands.current = bands;
  }, []);
  const snapshot = (): AnnotationSnapshot => ({ shapes: annot, refs: stagedRefs });
  // Un geste complet = un cran. Tant que le même `stepKey` revient (un glisser, cent
  // `pointermove`), l'historique n'en ouvre pas un deuxième.
  const openStep = (stepKey?: string) => {
    if (stepKey && stepKey === step.current) return;
    step.current = stepKey ?? null;
    setHist((h) => pushStep(h, snapshot()));
  };
  const addStagedRef = (dataUrl: string) => {
    openStep();
    setStagedRefs((rs) => [
      ...rs,
      {
        key: Math.random().toString(36).slice(2, 9),
        dataUrl,
        ...pastedRefBox(rs.length, refBands.current),
      },
    ]);
    // Coller sort du dessin et arme le déplacement de la référence : on vient de la poser,
    // le geste suivant est de la placer.
    setTool('ref');
  };
  const updateStagedRef = (
    key: string,
    patch: Partial<Pick<StagedReference, 'x' | 'y' | 'width'>>,
    stepKey?: string,
  ) => {
    openStep(stepKey);
    setStagedRefs((rs) =>
      rs.map((r) => (r.key === key ? { ...r, ...clampRefBox({ ...r, ...patch }, refBands.current) } : r)),
    );
  };
  const removeStagedRef = (key: string) => {
    openStep();
    setStagedRefs((rs) => rs.filter((r) => r.key !== key));
  };

  // Animation caméra jointe au commentaire en cours (mode layout) — staged avant envoi.
  const [cameraAnim, setCameraAnim] = useState<SplatLayoutAnim | null>(null);
  // Annotation d'un commentaire sélectionné (lecture seule)
  const [viewed, setViewed] = useState<Shape[] | null>(null);
  const [viewed3d, setViewed3d] = useState<Hotspot3D | null>(null);
  const [viewedAspect, setViewedAspect] = useState<number | null>(null);
  // Animation caméra du commentaire sélectionné — rejouée par le viewer.
  const [viewedCameraAnim, setViewedCameraAnim] = useState<SplatLayoutAnim | null>(null);
  // Proposition de scène 3D du commentaire sélectionné (46.D) — jamais globale.
  const [viewedSceneOverride, setViewedSceneOverride] = useState<unknown>(null);
  // Modifications de scène en cours, jointes au prochain commentaire envoyé (comme le
  // hotspot et l'animation caméra).
  const [sceneOverride, setSceneOverride] = useState<unknown>(null);

  /** `stepKey` : même valeur sur tout un geste (glisser d'une forme) = un seul cran. */
  const setShapes = (next: Shape[], stepKey?: string) => {
    openStep(stepKey);
    setAnnot(next);
  };
  const apply = (move: ReturnType<typeof undoStep>) => {
    if (!move) return;
    step.current = null;
    setHist(move.history);
    setAnnot(move.snapshot.shapes);
    setStagedRefs(move.snapshot.refs);
  };
  const undo = () => apply(undoStep(hist, snapshot()));
  const redo = () => apply(redoStep(hist, snapshot()));
  const clear = () => setShapes([]);
  const canUndo = hist.past.length > 0;
  const canRedo = hist.future.length > 0;
  // Le composer est dans les mains du lecteur dès qu'il annote ou qu'il a collé : c'est là,
  // et là seulement, que Ctrl+Z vise l'annotation plutôt que l'éditeur du média.
  useAnnotationShortcuts({
    enabled: annotating || stagedRefs.length > 0,
    canUndo,
    canRedo,
    undo,
    redo,
  });

  /** Réinitialise le composer (après envoi du commentaire). */
  const resetComposer = () => {
    setAnnot([]);
    setHist(EMPTY_HISTORY);
    step.current = null;
    setTool(drawTool.current);
    setHotspot3d(null);
    setCameraAnim(null);
    // La proposition de scène est partie avec le commentaire : comme le hotspot, elle ne doit
    // pas se rejoindre d'elle-même au commentaire suivant (46.T).
    setSceneOverride(null);
    setStagedRefs([]);
    setAnnotating(false);
  };

  /**
   * Masque l'annotation du commentaire sélectionné. `keepScene` (46.T) conserve la proposition
   * de scène 3D : un mouvement de vue efface le dessin (qui n'a de sens que depuis la caméra
   * d'origine) mais la scène modifiée doit rester navigable — on en sort par Échap ou le
   * bouton de retour du viewer.
   */
  const clearViewed = (opts?: { keepScene?: boolean }) => {
    setViewed(null);
    setViewed3d(null);
    setViewedAspect(null);
    setViewedCameraAnim(null);
    if (!opts?.keepScene) setViewedSceneOverride(null);
  };

  return {
    tool,
    setTool,
    exitRefTool,
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
    canUndo,
    canRedo,
    annotating,
    setAnnotating,
    hotspot3d,
    setHotspot3d,
    cameraAnim,
    setCameraAnim,
    stagedRefs,
    addStagedRef,
    updateStagedRef,
    removeStagedRef,
    setRefBands,
    viewed,
    setViewed,
    viewed3d,
    setViewed3d,
    viewedAspect,
    setViewedAspect,
    viewedCameraAnim,
    setViewedCameraAnim,
    viewedSceneOverride,
    setViewedSceneOverride,
    sceneOverride,
    setSceneOverride,
    resetComposer,
    clearViewed,
  };
}

export type Annotations = ReturnType<typeof useAnnotations>;
