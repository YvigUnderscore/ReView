import { useRef } from 'react';
import { toast } from 'sonner';
import { AnnotationCanvas, type Shape } from '../../components/AnnotationCanvas';
import { shapesOutsideFrame } from './frameRect';
import type { useAnnotations } from './useAnnotations';

/**
 * Overlay d'annotation 2D (extrait de ReviewViewer, budget 300) ; `captureAspect` (3D)
 * cale le dessin malgré un viewer de taille différente. Le wrapper est en
 * pointer-events-none : en lecture on peut orbiter (le modèle reçoit les events) ; en
 * édition la SVG les capte. Le dessin peut déborder du cadre de livraison (marge,
 * Phase 25) — signalé une fois à l'auteur.
 */
export function useAnnotationOverlay(ann: ReturnType<typeof useAnnotations>) {
  const warnedOutside = useRef(false);
  const onShapesChange = (s: Shape[]) => {
    ann.setShapes(s);
    if (!warnedOutside.current && shapesOutsideFrame(s)) {
      warnedOutside.current = true;
      toast.info('Une annotation dépasse le cadre de livraison — elle restera visible mais hors cadre.');
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
