import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_REVIEW_ASPECT, reviewFrame, type FrameRect } from './frameRect';

/**
 * Cadre de review (Phase 25 — viewer plein espace). Les enfants (canvas WebGL + HUD) occupent
 * TOUT le conteneur ; le **cadre de livraison** (aspect fixe issu de la présentation) est
 * matérialisé par un **guide letterbox** (zones hors-cadre assombries + liseré). Les éléments
 * passés en `frame` (overlay d'annotation) sont ancrés au guide : les annotations normalisées
 * 0..1 restent alignées pour tous les écrans — le cadre ne se resize plus selon la fenêtre
 * (la caméra est étendue au conteneur par `setViewOffset`, cf. `resizeRendererCamera`).
 */
export default function ReviewFrame({
  aspect = DEFAULT_REVIEW_ASPECT,
  children,
  frame,
}: {
  aspect?: number;
  children: ReactNode;
  /** Contenu ancré au cadre de livraison (overlay d'annotation 2D). */
  frame?: ReactNode;
}) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_REVIEW_ASPECT;
  const outerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const guide: FrameRect | null = size ? reviewFrame(a, size.w, size.h) : null;
  const showGuide = !!guide && !!size && (guide.width < size.w - 1 || guide.height < size.h - 1);

  return (
    <div ref={outerRef} className="relative h-full w-full">
      {/* Viewer plein espace */}
      <div className="absolute inset-0">{children}</div>

      {/* Guide letterbox : hors-cadre assombri + liseré du cadre de livraison */}
      {showGuide && guide && size && (
        <div className="pointer-events-none absolute inset-0 z-[5]">
          <div className="absolute left-0 top-0 w-full bg-black/40" style={{ height: guide.top }} />
          <div
            className="absolute bottom-0 left-0 w-full bg-black/40"
            style={{ height: size.h - guide.top - guide.height }}
          />
          <div
            className="absolute left-0 bg-black/40"
            style={{ top: guide.top, height: guide.height, width: guide.left }}
          />
          <div
            className="absolute right-0 bg-black/40"
            style={{ top: guide.top, height: guide.height, width: size.w - guide.left - guide.width }}
          />
          <div
            className="absolute border border-white/25"
            style={{ left: guide.left, top: guide.top, width: guide.width, height: guide.height }}
          />
        </div>
      )}

      {/* Contenu ancré au cadre de livraison (annotations) */}
      {frame && (
        <div
          className="absolute z-[6]"
          style={
            guide
              ? { left: guide.left, top: guide.top, width: guide.width, height: guide.height }
              : { inset: 0 }
          }
        >
          {frame}
        </div>
      )}
    </div>
  );
}
