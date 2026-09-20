// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Line2 } from 'three/addons/lines/Line2.js';
import { api } from '../../../../../lib/apiClient';
import { qk } from '../../../../lib/query';
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
  const [armed, setArmed] = useState<PaintTool | null>(null);
  const [color, setColor] = useState('#ff4d4d');
  const [width, setWidth] = useState(DEFAULT_STROKE_PX);
  const [pendingCount, setPendingCount] = useState(0);
  const [lines, setLines] = useState<LineModules | null>(null);
  // Commentaire consulté : son annotation brute (pour réécrire la liste des parts) et son
  // identifiant, non nul **seulement si le spectateur en est l'auteur** — c'est ce que le
  // serveur autorise à réécrire, et la gomme ne doit pas promettre davantage.
  const [viewed, setViewed] = useState<{ annotation: unknown; commentId: number | null }>({
    annotation: null,
    commentId: null,
  });
  const pendingRef = useRef<{ stroke: SplatPaintStroke; line: Line2 }[]>([]);
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

  /** Pose les traits d'un geste (un geste coupé sur un trou en produit plusieurs). */
  const addStrokes = useCallback(
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
    if (last) disposeStrokeLine(last.line);
    setPendingCount(pendingRef.current.length);
  }, []);

  /** Retire tous les traits du composer (après envoi du commentaire, ou abandon). */
  const clearPending = useCallback(() => {
    for (const p of pendingRef.current) disposeStrokeLine(p.line);
    pendingRef.current = [];
    setPendingCount(0);
  }, []);

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
  // c'est lui qui permet d'en retirer un sans toucher aux autres parts (hotspot, anim caméra).
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

  /** Retire un trait d'un commentaire déjà envoyé (auteur seulement, côté serveur aussi). */
  const eraseSent = useCallback(
    async (commentId: number, annotation: unknown, partIndex: number) => {
      const parts = Array.isArray(annotation) ? annotation : [];
      const next = parts.filter((_, index) => index !== partIndex);
      try {
        await api.patch(`/api/comments/${commentId}`, { annotation: next });
        setViewed({ annotation: next, commentId });
        await qc.invalidateQueries({ queryKey: qk.comments(mediaId) });
        toast.success(t('review.splat.strokeErased'));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('review.splat.strokeEraseFailed'));
      }
    },
    [qc, mediaId, t],
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
    gesture,
    eraseAt,
    undoStroke,
    clearPending,
    serializePending,
    showFromAnnotation,
  };
}

export type SplatPaintState = ReturnType<typeof useSplatPaint>;
