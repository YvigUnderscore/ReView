// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Line2 } from 'three/addons/lines/Line2.js';
import { api } from '../../../../../lib/apiClient';
import { qk } from '../../../../lib/query';
import { UNDO_PRIORITY, useUndoScope } from '../../../../lib/undoScope';
import { useUndoToast } from '../../../../lib/useUndoToast';
import { useT } from '../../../../i18n';
import type { SplatPaintStroke } from '../../reviewTypes';
import type { SplatViewer } from '../useSplat';
import { loadLineModules, type LineModules } from './lineModules';
import { DEFAULT_STROKE_PX, buildStrokeLine, decodeStrokes, disposeStrokeLine } from './strokes';
import { makeProjector, type Viewport } from './surfaceRay';
import { pickStroke } from './surfaceTrace';
import { useStrokeGesture } from './useStrokeGesture';

/**
 * Brosse de surface 3D de la review : traits peints sur la surface du splat, stockés en **espace
 * objet** et rattachés au commentaire en cours de rédaction (tableau `annotation`, comme le
 * hotspot) — non destructifs, visibles pour tous, et suivant la transformation du média.
 *
 * Ce hook tient l'état et la persistance ; le geste vit dans `useStrokeGesture`, la géométrie
 * dans `surfaceTrace`, le rendu dans `strokes`/`strokeFrame`.
 *
 * La gomme est le second outil de la brosse (`armed === 'erase'`) : elle retire un trait en
 * préparation, et — si le spectateur est l'auteur du commentaire consulté — un trait déjà
 * envoyé, en réécrivant la liste des parts de son annotation. Il n'y avait jusqu'ici aucun
 * moyen de revenir sur un trait autre que « tout effacer avant d'envoyer ».
 */
export type PaintTool = 'paint' | 'erase';

/** Trait affiché : le trait, sa ligne 3D, et sa place dans l'annotation du commentaire. */
interface ShownStroke {
  stroke: SplatPaintStroke;
  line: Line2;
  partIndex: number;
}

export function useSplatPaint(splat: SplatViewer, isSplat: boolean, mediaId: number) {
  const { getSceneHandle } = splat;
  const t = useT();
  const qc = useQueryClient();
  const { done } = useUndoToast();
  const [armed, setArmed] = useState<PaintTool | null>(null);
  const [color, setColor] = useState('#ff4d4d');
  const [width, setWidth] = useState(DEFAULT_STROKE_PX);
  const [pendingCount, setPendingCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [lines, setLines] = useState<LineModules | null>(null);
  // Commentaire consulté : son annotation brute (pour réécrire la liste des parts) et son
  // identifiant, non nul **seulement si le spectateur en est l'auteur** — c'est ce que le
  // serveur autorise à réécrire, et la gomme ne doit pas promettre davantage.
  const [viewed, setViewed] = useState<{ annotation: unknown; commentId: number | null }>({
    annotation: null,
    commentId: null,
  });
  const pendingRef = useRef<{ stroke: SplatPaintStroke; line: Line2 }[]>([]);
  // Traits annulés, en attente d'un rétablissement. On ne garde que la DONNÉE du trait : sa
  // ligne Three a été libérée en l'annulant (`disposeStrokeLine` rend sa géométrie), elle est
  // donc reconstruite au rétablissement — un objet libéré ne se remet pas dans la scène.
  const undoneRef = useRef<SplatPaintStroke[]>([]);
  const shownRef = useRef<ShownStroke[]>([]);
  // Miroirs lus depuis les gestionnaires (jamais pendant le render — règle react-hooks/refs).
  const viewedRef = useRef(viewed);
  const linesRef = useRef<LineModules | null>(null);
  useEffect(() => {
    viewedRef.current = viewed;
    linesRef.current = lines;
  }, [viewed, lines]);

  // Classes Line2 importées dès qu'un splat est ouvert : tout le reste est ensuite synchrone.
  useEffect(() => {
    if (!isSplat) return;
    let cancelled = false;
    void loadLineModules().then((loaded) => {
      if (!cancelled) setLines(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [isSplat]);

  /** Construit et monte des traits dans la scène, sans toucher à la pile de rétablissement. */
  const attachStrokes = useCallback(
    (strokes: SplatPaintStroke[]) => {
      const handle = getSceneHandle();
      const modules = linesRef.current;
      if (!handle || !modules) return;
      for (const stroke of strokes) {
        const line = buildStrokeLine(handle, modules, stroke);
        handle.mesh.add(line);
        pendingRef.current.push({ stroke, line });
      }
      setPendingCount(pendingRef.current.length);
    },
    [getSceneHandle],
  );

  /** Pose les traits d'un geste (un geste coupé sur un trou en produit plusieurs). */
  const addStrokes = useCallback(
    (strokes: SplatPaintStroke[]) => {
      attachStrokes(strokes);
      // Un trait neuf rend le futur inatteignable — règle de toute pile d'historique.
      undoneRef.current = [];
      setRedoCount(0);
    },
    [attachStrokes],
  );

  const getLines = useCallback(() => linesRef.current, []);
  const gesture = useStrokeGesture({ getSceneHandle, getLines, color, width, onStrokes: addStrokes });
  const { cancel: cancelGesture } = gesture;

  // Désarmer la brosse abandonne l'aperçu en cours : plus aucun geste ne le porte.
  useEffect(() => {
    if (armed !== 'paint') cancelGesture();
  }, [armed, cancelGesture]);

  /** Annule le dernier trait du composer. */
  const undoStroke = useCallback(() => {
    const last = pendingRef.current.pop();
    if (!last) return;
    disposeStrokeLine(last.line);
    undoneRef.current.push(last.stroke);
    setPendingCount(pendingRef.current.length);
    setRedoCount(undoneRef.current.length);
  }, []);

  /** Rétablit le dernier trait annulé — il n'y avait aucun moyen de revenir sur un Ctrl+Z. */
  const redoStroke = useCallback(() => {
    const stroke = undoneRef.current.pop();
    if (!stroke) return;
    attachStrokes([stroke]);
    setRedoCount(undoneRef.current.length);
  }, [attachStrokes]);

  /** Retire tous les traits du composer (après envoi du commentaire, ou abandon). */
  const clearPending = useCallback(() => {
    for (const p of pendingRef.current) disposeStrokeLine(p.line);
    pendingRef.current = [];
    undoneRef.current = [];
    setPendingCount(0);
    setRedoCount(0);
  }, []);

  /**
   * Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y sur les traits en préparation.
   *
   * Le bouton « annuler le dernier trait » de la barre d'options était le seul retour en
   * arrière de la brosse, et il n'avait pas de réciproque. Les traits en préparation sont
   * PUREMENT LOCAUX — ils partiront avec le commentaire, rien n'est encore chez le serveur :
   * un vrai historique, donc un vrai Ctrl+Z, sans rien promettre qu'on ne tienne.
   *
   * Le périmètre reste inscrit tant qu'un trait est en préparation, même brosse désarmée :
   * on désarme souvent avant de se relire. Il passe avant l'éditeur de splat, qui écoute les
   * mêmes touches (`lib/undoScope`), et se retire dès qu'il n'a plus rien à rendre.
   */
  useUndoScope({
    enabled: isSplat && (armed !== null || pendingCount > 0 || redoCount > 0),
    priority: UNDO_PRIORITY.brush3d,
    canUndo: pendingCount > 0,
    canRedo: redoCount > 0,
    undo: undoStroke,
    redo: redoStroke,
  });

  /** Parties d'annotation à joindre au commentaire en cours d'envoi. */
  const serializePending = useCallback((): SplatPaintStroke[] => {
    return pendingRef.current.map((p) => p.stroke);
  }, []);

  /**
   * Affiche les traits du commentaire sélectionné (annotation nulle = masquer). `commentId` n'est
   * passé que si le spectateur peut réécrire ce commentaire : il ouvre la gomme sur ses traits.
   */
  const showFromAnnotation = useCallback((annotation: unknown, commentId: number | null = null) => {
    setViewed((prev) =>
      prev.annotation === annotation && prev.commentId === commentId ? prev : { annotation, commentId },
    );
  }, []);

  // Rendu des traits du commentaire consulté. L'index de part est conservé trait par trait :
  // c'est lui qui permet d'en retirer un sans toucher aux autres parts (points, anim caméra).
  useEffect(() => {
    for (const shown of shownRef.current) disposeStrokeLine(shown.line);
    shownRef.current = [];
    const handle = getSceneHandle();
    if (!handle || !lines) return;
    const parts = Array.isArray(viewed.annotation) ? viewed.annotation : [];
    parts.forEach((part, partIndex) => {
      const [stroke] = decodeStrokes([part]);
      if (!stroke) return;
      const line = buildStrokeLine(handle, lines, stroke);
      handle.mesh.add(line);
      shownRef.current.push({ stroke, line, partIndex });
    });
  }, [viewed, lines, getSceneHandle]);

  /**
   * Retire un trait d'un commentaire déjà envoyé (auteur seulement, côté serveur aussi).
   *
   * Ici, pas de Ctrl+Z : le trait est **parti**, il est dans le commentaire que les autres
   * lisent, et l'effacer réécrit la liste des parts côté serveur. Le cran se propose donc dans
   * le toast, et il ne promet que celui-là — on tient la liste d'avant, rien de plus. Un
   * historique local sur des données déjà partagées mentirait au premier rechargement.
   */
  const eraseSent = useCallback(
    async (commentId: number, annotation: unknown, partIndex: number) => {
      const parts = Array.isArray(annotation) ? annotation : [];
      const next = parts.filter((_, index) => index !== partIndex);
      /** Pose une liste de parts et rafraîchit le fil. Elle laisse remonter son échec. */
      const writeParts = async (value: unknown[]): Promise<void> => {
        await api.patch(`/api/comments/${commentId}`, { annotation: value });
        setViewed({ annotation: value, commentId });
        await qc.invalidateQueries({ queryKey: qk.comments(mediaId) });
      };
      try {
        await writeParts(next);
        done(t('review.splat.strokeErased'), () => writeParts(parts));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('review.splat.strokeEraseFailed'));
      }
    },
    [qc, mediaId, t, done],
  );

  /** Gomme au clic : le trait en préparation le plus proche, sinon celui du commentaire lu. */
  const eraseAt = useCallback(
    (point: [number, number], viewport: Viewport) => {
      const handle = getSceneHandle();
      if (!handle) return;
      const project = makeProjector(handle, viewport);
      const pending = pickStroke(
        pendingRef.current.map((p) => p.stroke),
        point,
        project,
      );
      if (pending !== null) {
        disposeStrokeLine(pendingRef.current[pending].line);
        pendingRef.current.splice(pending, 1);
        setPendingCount(pendingRef.current.length);
        return;
      }
      const shown = pickStroke(
        shownRef.current.map((s) => s.stroke),
        point,
        project,
      );
      if (shown === null) return;
      const { commentId, annotation } = viewedRef.current;
      if (commentId === null) {
        toast.error(t('review.splat.strokeNotYours'));
        return;
      }
      void eraseSent(commentId, annotation, shownRef.current[shown].partIndex);
    },
    [getSceneHandle, eraseSent, t],
  );

  // Nettoyage au démontage (la page remonte par média : la scène disparaît avec les lignes).
  useEffect(
    () => () => {
      for (const p of pendingRef.current) disposeStrokeLine(p.line);
      pendingRef.current = [];
      for (const shown of shownRef.current) disposeStrokeLine(shown.line);
      shownRef.current = [];
    },
    [],
  );

  return {
    isSplat,
    /** Outil de brosse armé par le rail (null : aucun — l'overlay n'est pas monté). */
    armed: isSplat ? armed : null,
    setArmed,
    active: isSplat && armed !== null,
    color,
    setColor,
    width,
    setWidth,
    pendingCount,
    /** Traits annulés, rétablissables (grise le bouton « rétablir »). */
    redoCount,
    gesture,
    eraseAt,
    undoStroke,
    redoStroke,
    clearPending,
    serializePending,
    showFromAnnotation,
  };
}

export type SplatPaintState = ReturnType<typeof useSplatPaint>;
