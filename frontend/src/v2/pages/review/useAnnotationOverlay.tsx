// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { AnnotationCanvas, type Shape } from '../../components/AnnotationCanvas';
import { shapesOutsideFrame } from './frameRect';
import type { useAnnotations } from './useAnnotations';
import type { useModel3DThree } from './three/useModel3DThree';
import type { SplatViewer } from './splat/useSplat';
import { useT } from '../../i18n';

/**
 * Overlay d'annotation 2D (extrait de ReviewViewer, budget 300) ; `captureAspect` (3D)
 * cale le dessin malgré un viewer de taille différente. Le wrapper est en
 * pointer-events-none : en lecture on peut orbiter (le modèle reçoit les events) ; en
 * édition la SVG les capte. Le dessin peut déborder du cadre de livraison (marge,
 * Phase 25) — signalé une fois à l'auteur.
 */
/**
 * Points d'intérêt 3D/splat (extrait de ReviewViewer) : affiche les pastilles numérotées du
 * commentaire sélectionné, sinon celles en cours de rédaction — projetées par le viewer.
 *
 * Les deux viewers reçoivent la même liste par la même poignée (`showPoiPoints`) : c'est la
 * numérotation de la scène, et elle vaut pour le modèle 3D comme pour le splat.
 */
export function usePoiDisplay(
  kind: string | undefined,
  ann: ReturnType<typeof useAnnotations>,
  splat: SplatViewer,
  model3d: ReturnType<typeof useModel3DThree>,
) {
  const { showPoiPoints } = splat;
  const { showPoiPoints: showModelPoi } = model3d;
  const spatial = kind === 'SPLAT' || kind === 'MODEL_3D';
  const viewed = ann.viewedPoi;
  const draft = ann.poi.points;
  // Une liste stable d'un rendu à l'autre : sans ce mémo, l'effet réécrirait les pastilles à
  // chaque rendu du composeur (frappe au clavier comprise).
  const points = useMemo(
    () =>
      !spatial
        ? []
        : viewed.length > 0
          ? viewed
          : draft.map(({ position, normal, space }) => ({ position, normal, space })),
    [spatial, viewed, draft],
  );
  useEffect(() => {
    if (kind === 'SPLAT') showPoiPoints(points);
    else if (kind === 'MODEL_3D') showModelPoi(points);
  }, [kind, points, showPoiPoints, showModelPoi]);
}

export function useAnnotationOverlay(ann: ReturnType<typeof useAnnotations>) {
  const t = useT();
  const warnedOutside = useRef(false);
  const onShapesChange = (s: Shape[]) => {
    ann.setShapes(s);
    if (!warnedOutside.current && shapesOutsideFrame(s)) {
      warnedOutside.current = true;
      toast.info(t('review.annotation.outOfFrame'));
    }
  };
  return (captureAspect?: number) =>
    ann.annotating || ann.viewed ? (
      <AnnotationCanvas
        shapes={ann.viewed ?? ann.annot}
        onChange={onShapesChange}
        editable={ann.annotating && !ann.viewed}
        tool={ann.tool}
        color={ann.color}
        width={ann.penWidth}
        alpha={ann.alpha}
        captureAspect={captureAspect}
        margin={0.5}
      />
    ) : null;
}
