// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import { AnnotationCanvas, type Shape } from '../../components/AnnotationCanvas';
import type { ReviewComment } from '../../types/api';
import { shapesOutsideFrame } from './frameRect';
import PoiSceneCards from './poi/PoiSceneCards';
import { buildPoiSceneCards } from './poi/poiCards';
import { stripPoiBlock } from './poi/poiPoints';
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
/** Commentaire sélectionné — une réponse se sélectionne comme les autres, elle compte donc. */
function findComment(comments: readonly ReviewComment[] | null | undefined, id: number | null) {
  if (id == null) return null;
  for (const c of comments ?? []) {
    if (c.id === id) return c;
    const reply = c.replies?.find((r) => r.id === id);
    if (reply) return reply;
  }
  return null;
}

/**
 * Points d'intérêt 3D/splat (extrait de ReviewViewer) : affiche les pastilles numérotées du
 * commentaire sélectionné, sinon celles en cours de rédaction — projetées par le viewer.
 *
 * Les deux viewers reçoivent la même liste par la même poignée (`showPoiPoints`) : c'est la
 * numérotation de la scène, et elle vaut pour le modèle 3D comme pour le splat.
 *
 * Rend le calque des **cartes de commentaire ancrées dans la scène** (`poi/PoiSceneCards`) : le
 * commentaire relu se lit à son point, images comprises, sans quitter la scène des yeux. Le calque
 * se pose par portail dans les pastilles du viewer — sa place dans l'arbre React n'a donc aucune
 * importance, et il ne coûte rien à la boucle de rendu.
 */
export function usePoiDisplay(
  kind: string | undefined,
  ann: ReturnType<typeof useAnnotations>,
  splat: SplatViewer,
  model3d: ReturnType<typeof useModel3DThree>,
  comments: readonly ReviewComment[] | null | undefined,
  selectedCommentId: number | null,
): ReactNode {
  const t = useT();
  const { showPoiPoints } = splat;
  const { showPoiPoints: showModelPoi } = model3d;
  const spatial = kind === 'SPLAT' || kind === 'MODEL_3D';
  const viewed = ann.viewedPoi;
  const draft = ann.poi.points;
  // PRIORITÉ AU COMMENTAIRE RELU : cliquer un commentaire doit montrer SES points, même au milieu
  // d'une rédaction. C'est `usePoiPlacement` qui rend l'écran au brouillon, en relâchant les points
  // relus quand on arme l'outil — la seule chose qui puisse vouloir la place.
  //
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

  // Cartes du commentaire relu : mémoïsées, car le calque s'abonne aux pastilles sur leur
  // identité — une liste neuve à chaque rendu le réabonnerait sans fin.
  const comment = findComment(comments, selectedCommentId);
  const cards = useMemo(
    () =>
      !spatial || viewed.length === 0 || !comment
        ? []
        : buildPoiSceneCards({
            points: viewed,
            attachments: comment.attachments,
            intro: stripPoiBlock(comment.content, viewed),
            author:
              comment.author?.displayName ??
              comment.author?.name ??
              comment.guestName ??
              t('comments.anonymous'),
          }),
    [spatial, viewed, comment, t],
  );
  if (cards.length === 0) return null;
  return (
    <PoiSceneCards
      key={comment?.id}
      containerRef={kind === 'SPLAT' ? splat.containerRef : model3d.containerRef}
      cards={cards}
    />
  );
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
