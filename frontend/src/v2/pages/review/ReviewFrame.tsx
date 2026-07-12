import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_REVIEW_ASPECT, reviewFrame, type FrameRect } from './frameRect';

/**
 * Cadre de review à aspect fixe (V6). Rend ses enfants (viewport WebGL 3D/splat + overlays
 * d'annotation + HUD) dans une box **letterboxée** d'aspect constant, centrée dans la zone
 * disponible : la mise en scène et les annotations 2D normalisées restent alignées pour tous
 * quelle que soit la taille de l'écran (le canvas ne « scale » plus avec la fenêtre). Les enfants
 * se positionnent en `absolute inset-0` par rapport à ce cadre. Rect calculé par le helper pur
 * `reviewFrame` (mesuré via ResizeObserver).
 */
export default function ReviewFrame({
  aspect = DEFAULT_REVIEW_ASPECT,
  children,
}: {
  aspect?: number;
  children: ReactNode;
}) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_REVIEW_ASPECT;
  const outerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<FrameRect | null>(null);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => setRect(reviewFrame(a, el.clientWidth, el.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [a]);

  return (
    <div ref={outerRef} className="relative h-full w-full">
      <div
        className="absolute"
        style={
          rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { inset: 0 }
        }
      >
        {children}
      </div>
    </div>
  );
}
