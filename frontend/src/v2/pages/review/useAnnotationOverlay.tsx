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
 * 2D annotation overlay (extracted from ReviewViewer, budget 300); `captureAspect` (3D) fits the
 * drawing despite a viewer of a different size. The wrapper is pointer-events-none: when reading,
 * one can orbit (the model receives the events); when editing, the SVG captures them. The drawing may
 * overflow the delivery frame (margin, Phase 25) — flagged once to the author.
 */
/** Selected comment — a reply is selected like the others, so it counts. */
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
 * 3D/splat points of interest (extracted from ReviewViewer): shows the numbered dots of the selected
 * comment, otherwise those being drafted — projected by the viewer.
 *
 * Both viewers receive the same list through the same handle (`showPoiPoints`): it is the scene's
 * numbering, and it applies to the 3D model as well as to the splat.
 *
 * Renders the layer of **comment cards anchored in the scene** (`poi/PoiSceneCards`): the comment
 * being read is read at its point, images included, without taking one's eyes off the scene. The
 * layer is placed by portal into the viewer's dots — its place in the React tree therefore does not
 * matter, and it costs nothing to the render loop.
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
  // PRIORITY TO THE COMMENT BEING READ: clicking a comment must show ITS points, even in the middle
  // of a draft. `usePoiPlacement` gives the screen back to the draft, releasing the points being read
  // when the tool is armed — the only thing that could want the place.
  //
  // A list stable from one render to the next: without this memo, the effect would rewrite the dots
  // on every render of the composer (keystrokes included).
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

  // Cards of the comment being read: memoized, because the layer subscribes to the dots by their
  // identity — a new list on every render would resubscribe endlessly.
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
