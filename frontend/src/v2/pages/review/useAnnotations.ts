// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import type { Shape, Tool } from '../../components/AnnotationCanvas';
import type { Hotspot3D, SplatLayoutAnim } from './reviewTypes';

/** Image de référence en préparation dans le composer (locale, envoyée avec le commentaire). */
export interface StagedReference {
  key: string;
  dataUrl: string;
  x: number;
  y: number;
  width: number;
}

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
export function useAnnotations(opts?: {
  defaultColor?: string;
  onColorChange?: (c: string) => void;
  /** Formes initiales du composer (initialiseur paresseux — brouillon local 32.C). */
  initialShapes?: () => Shape[];
}) {
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
  const [annot, setAnnot] = useState<Shape[]>(opts?.initialShapes ?? []);
  const [past, setPast] = useState<Shape[][]>([]);
  const [future, setFuture] = useState<Shape[][]>([]);
  const [annotating, setAnnotating] = useState(false);
  const [hotspot3d, setHotspot3d] = useState<Hotspot3D | null>(null);
  // Images de référence en préparation : posées/déplaçables tant que le commentaire n'est
  // pas envoyé, puis figées côté serveur (liées au commentaire créé).
  const [stagedRefs, setStagedRefs] = useState<StagedReference[]>([]);
  const addStagedRef = (dataUrl: string) =>
    setStagedRefs((rs) => [
      ...rs,
      {
        key: Math.random().toString(36).slice(2, 9),
        dataUrl,
        x: 1.05 + rs.length * 0.03,
        y: rs.length * 0.03,
        width: 0.3,
      },
    ]);
  const updateStagedRef = (key: string, patch: Partial<Pick<StagedReference, 'x' | 'y' | 'width'>>) =>
    setStagedRefs((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeStagedRef = (key: string) => setStagedRefs((rs) => rs.filter((r) => r.key !== key));

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
    stagedRefs,
    addStagedRef,
    updateStagedRef,
    removeStagedRef,
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
