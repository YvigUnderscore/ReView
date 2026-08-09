// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type RefObject } from 'react';
import type { ReviewComment } from '../../types/api';
import { type Shape } from '../../components/AnnotationCanvas';
import { splitAnnotationParts, type MediaResp } from './reviewTypes';
import type { useAnnotations } from './useAnnotations';
import type { useSplat } from './splat/useSplat';
import type { useSplatPaint } from './splat/paint/useSplatPaint';
import type { useModel3DThree } from './three/useModel3DThree';

/**
 * Le commentaire affiché, et tout ce qu'il faut remettre en place pour le revoir (10.C2).
 *
 * Un commentaire de review n'est pas qu'un texte : il porte une frame, des formes 2D, un
 * hotspot 3D, une animation de caméra, une proposition de scène. Le rouvrir doit restaurer
 * l'ENSEMBLE, sans quoi l'annotation se lit sur la mauvaise image. Rassembler ces gestes
 * ici évite qu'un écran n'en restaure qu'une partie.
 */
export function useCommentSelection({
  data,
  ann,
  paint,
  splat,
  model3d,
  videoRef,
  programmaticSeekRef,
}: {
  data: MediaResp | null;
  ann: ReturnType<typeof useAnnotations>;
  paint: ReturnType<typeof useSplatPaint>;
  splat: ReturnType<typeof useSplat>;
  model3d: ReturnType<typeof useModel3DThree>;
  videoRef: RefObject<HTMLVideoElement | null>;
  programmaticSeekRef: { current: boolean };
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const seek = (t: number) => {
    if (!videoRef.current) return;
    programmaticSeekRef.current = true;
    videoRef.current.currentTime = t;
  };

  // Désélectionne le commentaire courant et masque toute annotation affichée.
  // `keepScene` (46.T) : un mouvement de vue 3D garde la proposition de scène navigable.
  const clear = (opts?: { keepScene?: boolean }) => {
    setSelectedId(null);
    ann.clearViewed(opts);
    paint.showFromAnnotation(null);
  };

  // Sélection d'un commentaire : restaure ensemble seek + annotation 2D/3D + caméra (animée).
  const select = (c: ReviewComment) => {
    setSelectedId(c.id);
    const { hotspot, shapes, cameraAnim, sceneOverride } = splitAnnotationParts(c.annotation);
    ann.setViewed3d(hotspot);
    // Mode layout : anim caméra jointe → rejouée par le viewer (3D/splat).
    ann.setViewedCameraAnim(cameraAnim);
    // Proposition de scène 3D jointe (46.D) : rejouée pour ce commentaire seulement.
    ann.setViewedSceneOverride(sceneOverride);
    if (shapes.length > 0) {
      ann.setAnnotating(false);
      ann.setViewed(shapes as unknown as Shape[]);
    } else ann.setViewed(null);
    // Traits du painter 3D (V9) : rendus sur le splat pour ce commentaire.
    if (data?.media.kind === 'SPLAT') paint.showFromAnnotation(c.annotation);
    // Ratio capturé (3D: cameraState.aspect) pour caler l'overlay
    const cam = c.cameraState as { aspect?: number } | null;
    ann.setViewedAspect(cam?.aspect ?? null);
    if (c.timestamp != null) {
      // Pause : l'annotation est alignée sur cette frame ; la lecture la masquerait aussitôt.
      videoRef.current?.pause();
      seek(c.timestamp);
    }
    if (c.cameraState != null) {
      if (data?.media.kind === 'SPLAT') splat.restoreCamera(c.cameraState);
      else model3d.restoreCamera(c.cameraState);
    }
  };

  return { selectedId, select, clear, seek };
}
