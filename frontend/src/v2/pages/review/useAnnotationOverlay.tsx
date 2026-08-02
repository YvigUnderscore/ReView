// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
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
 * Hotspot 3D/splat (10.G, extrait de ReviewViewer) : affiche celui du commentaire
 * sélectionné, sinon celui en cours de placement — marqueur projeté par le viewer.
 */
export function useHotspotDisplay(
  kind: string | undefined,
  ann: ReturnType<typeof useAnnotations>,
  splat: SplatViewer,
  model3d: ReturnType<typeof useModel3DThree>,
) {
  const { showHotspot } = splat;
  const { showHotspot: showModelHotspot } = model3d;
  const hotspot3d = kind === 'SPLAT' || kind === 'MODEL_3D' ? (ann.viewed3d ?? ann.hotspot3d) : null;
  useEffect(() => {
    if (kind === 'SPLAT') showHotspot(hotspot3d);
    else if (kind === 'MODEL_3D') showModelHotspot(hotspot3d);
  }, [kind, hotspot3d, showHotspot, showModelHotspot]);
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
