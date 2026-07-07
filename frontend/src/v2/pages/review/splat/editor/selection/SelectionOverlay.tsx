import { useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { normalizeRect, type SelectCombine, type SelectionShape } from './shapes2d';

/** Distance (px) entre deux points consécutifs du lasso (limite la taille du polygone). */
const LASSO_STEP = 3;

/**
 * Overlay de tracé de sélection (10.G) : capte le pointeur quand un outil de sélection est
 * actif, dessine le rectangle ou le lasso en SVG (tokens de thème via currentColor) et remonte
 * la forme au lâcher avec le mode de combinaison (Maj = ajouter, Alt = retirer). La molette
 * est relayée au canvas pour conserver le zoom d'orbite pendant la sélection.
 */
export default function SelectionOverlay({
  tool,
  getCanvas,
  onCommit,
}: {
  tool: 'rect' | 'lasso';
  /** Canvas Three (résolu à la demande) pour relayer la molette à l'orbite. */
  getCanvas: () => HTMLElement | null;
  onCommit: (
    shape: SelectionShape,
    combine: SelectCombine,
    viewport: { width: number; height: number },
  ) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ start: [number, number]; points: [number, number][] } | null>(null);

  const local = (e: PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointeur synthétique (tests) sans capture possible — le drag fonctionne quand même
    }
    const p = local(e);
    setDrag({ start: p, points: [p] });
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return;
    const p = local(e);
    setDrag((d) => {
      if (!d) return d;
      if (tool === 'rect') return { ...d, points: [p] };
      const last = d.points[d.points.length - 1]!;
      const dist = Math.hypot(p[0] - last[0], p[1] - last[1]);
      return dist >= LASSO_STEP ? { ...d, points: [...d.points, p] } : d;
    });
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!drag) return;
    const el = ref.current;
    setDrag(null);
    if (!el) return;
    const combine: SelectCombine = e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace';
    const viewport = { width: el.clientWidth, height: el.clientHeight };
    const [x0, y0] = drag.start;
    const [x1, y1] = local(e);
    if (tool === 'rect') {
      const rect = normalizeRect(x0, y0, x1, y1);
      if (rect.w < 2 && rect.h < 2) return; // simple clic : ignoré (pas de sélection vide)
      onCommit({ kind: 'rect', rect }, combine, viewport);
    } else {
      if (drag.points.length < 3) return;
      onCommit({ kind: 'lasso', points: drag.points }, combine, viewport);
    }
  };

  // Relaye la molette au canvas Three (OrbitControls) pour garder le zoom pendant la sélection.
  const onWheel = (e: WheelEvent) => {
    getCanvas()?.dispatchEvent(new globalThis.WheelEvent('wheel', e.nativeEvent));
  };

  const cur = drag?.points[drag.points.length - 1];
  const rect = drag && cur ? normalizeRect(drag.start[0], drag.start[1], cur[0], cur[1]) : null;

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-10 cursor-crosshair touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      {drag && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full text-primary">
          {tool === 'rect' && rect ? (
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.w}
              height={rect.h}
              fill="currentColor"
              fillOpacity={0.08}
              stroke="currentColor"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          ) : (
            <polygon
              points={drag.points.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="currentColor"
              fillOpacity={0.08}
              stroke="currentColor"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          )}
        </svg>
      )}
    </div>
  );
}
