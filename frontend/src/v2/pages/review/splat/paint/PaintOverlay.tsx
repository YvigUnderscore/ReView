import { useRef, useState, type PointerEvent, type WheelEvent } from 'react';

/** Distance (px) entre deux échantillons du trait (limite le nombre de raycasts). */
const SAMPLE_STEP = 6;

/**
 * Overlay de peinture 3D (10.G-V9) : capte le drag quand le painter est actif, dessine la
 * polyligne en SVG (feedback immédiat) et remonte les échantillons écran au lâcher — le hook
 * raycaste alors la surface et construit le tube 3D. Molette relayée au canvas (zoom conservé).
 */
export default function PaintOverlay({
  color,
  getCanvas,
  onStroke,
}: {
  color: string;
  getCanvas: () => HTMLElement | null;
  onStroke: (points: [number, number][], viewport: { width: number; height: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<[number, number][] | null>(null);

  const local = (e: PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointeur synthétique (tests) sans capture possible
    }
    setPoints([local(e)]);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!points) return;
    const p = local(e);
    setPoints((pts) => {
      if (!pts) return pts;
      const last = pts[pts.length - 1]!;
      return Math.hypot(p[0] - last[0], p[1] - last[1]) >= SAMPLE_STEP ? [...pts, p] : pts;
    });
  };

  const onPointerUp = () => {
    if (!points) return;
    const el = ref.current;
    setPoints(null);
    if (!el || points.length < 2) return;
    onStroke(points, { width: el.clientWidth, height: el.clientHeight });
  };

  const onWheel = (e: WheelEvent) => {
    getCanvas()?.dispatchEvent(new globalThis.WheelEvent('wheel', e.nativeEvent));
  };

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-10 cursor-crosshair touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      {points && points.length > 1 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <polyline
            points={points.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
