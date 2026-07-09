import { useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { normalizeRect, type SelectCombine, type SelectionShape } from './shapes2d';

/** Distance (px) entre deux points consécutifs du lasso (limite la taille du polygone). */
const LASSO_STEP = 3;

/**
 * Overlay de tracé de sélection (10.G) : capte le pointeur quand un outil de sélection est
 * actif, dessine le rectangle, le lasso ou le curseur du pinceau en SVG (tokens de thème via
 * currentColor) et remonte la forme (au lâcher) ou les coups de pinceau (en continu, V3) avec
 * le mode de combinaison (Maj = ajouter, Alt = retirer ; pinceau : le 1ᵉʳ coup sans modificateur
 * remplace, les suivants du même geste ajoutent). La molette est relayée au canvas pour
 * conserver le zoom d'orbite pendant la sélection.
 */
export default function SelectionOverlay({
  tool,
  brushRadius = 40,
  getCanvas,
  onCommit,
  onBrush,
}: {
  tool: 'rect' | 'lasso' | 'brush';
  /** Rayon du pinceau en pixels (outil brush). */
  brushRadius?: number;
  /** Canvas Three (résolu à la demande) pour relayer la molette à l'orbite. */
  getCanvas: () => HTMLElement | null;
  onCommit: (
    shape: SelectionShape,
    combine: SelectCombine,
    viewport: { width: number; height: number },
  ) => void;
  /** Coup de pinceau (outil brush) — appelé en continu pendant le drag. */
  onBrush?: (
    point: { x: number; y: number },
    combine: SelectCombine,
    viewport: { width: number; height: number },
  ) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ start: [number, number]; points: [number, number][] } | null>(null);
  // Curseur du pinceau (suivi hors drag pour afficher le cercle) + combinaison du geste en cours.
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const brushStroke = useRef<{ combine: SelectCombine; last: [number, number] } | null>(null);

  const local = (e: PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const viewport = () => ({ width: ref.current!.clientWidth, height: ref.current!.clientHeight });

  const stamp = (p: [number, number], combine: SelectCombine) => {
    onBrush?.({ x: p[0], y: p[1] }, combine, viewport());
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointeur synthétique (tests) sans capture possible — le drag fonctionne quand même
    }
    const p = local(e);
    if (tool === 'brush') {
      const combine: SelectCombine = e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace';
      brushStroke.current = { combine, last: p };
      stamp(p, combine);
      return;
    }
    setDrag({ start: p, points: [p] });
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = local(e);
    if (tool === 'brush') {
      setCursor(p);
      const stroke = brushStroke.current;
      if (!stroke) return;
      const dist = Math.hypot(p[0] - stroke.last[0], p[1] - stroke.last[1]);
      if (dist < Math.max(3, brushRadius / 3)) return;
      stroke.last = p;
      // Après le 1ᵉʳ coup, le geste cumule (un « replace » par déplacement viderait le trait).
      if (stroke.combine === 'replace') stroke.combine = 'add';
      stamp(p, stroke.combine);
      return;
    }
    if (!drag) return;
    setDrag((d) => {
      if (!d) return d;
      if (tool === 'rect') return { ...d, points: [p] };
      const last = d.points[d.points.length - 1]!;
      const dist = Math.hypot(p[0] - last[0], p[1] - last[1]);
      return dist >= LASSO_STEP ? { ...d, points: [...d.points, p] } : d;
    });
  };

  const onPointerUp = (e: PointerEvent) => {
    if (tool === 'brush') {
      brushStroke.current = null;
      return;
    }
    if (!drag) return;
    const el = ref.current;
    setDrag(null);
    if (!el) return;
    const combine: SelectCombine = e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace';
    const [x0, y0] = drag.start;
    const [x1, y1] = local(e);
    if (tool === 'rect') {
      const rect = normalizeRect(x0, y0, x1, y1);
      if (rect.w < 2 && rect.h < 2) return; // simple clic : ignoré (pas de sélection vide)
      onCommit({ kind: 'rect', rect }, combine, viewport());
    } else {
      if (drag.points.length < 3) return;
      onCommit({ kind: 'lasso', points: drag.points }, combine, viewport());
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
      className={`absolute inset-0 z-10 touch-none ${tool === 'brush' ? 'cursor-none' : 'cursor-crosshair'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setCursor(null)}
      onWheel={onWheel}
    >
      {tool === 'brush' && cursor && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full text-primary">
          <circle
            cx={cursor[0]}
            cy={cursor[1]}
            r={brushRadius}
            fill="currentColor"
            fillOpacity={0.06}
            stroke="currentColor"
            strokeWidth={1.5}
          />
          <circle cx={cursor[0]} cy={cursor[1]} r={1.5} fill="currentColor" />
        </svg>
      )}
      {drag && tool !== 'brush' && (
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
