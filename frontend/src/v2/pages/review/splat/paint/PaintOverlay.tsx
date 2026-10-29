// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { PaintTool } from './useSplatPaint';
import type { StrokeGesture } from './useStrokeGesture';
import { ERASE_TOLERANCE_PX } from './surfaceTrace';

/** Distance (px) between two samples of the stroke: one surface raycast per sample. */
const SAMPLE_STEP = 6;

/**
 * Overlay of the 3D surface brush: captures the gesture, reports it sample by sample (the hook
 * raycasts and builds the 3D stroke along the way) and shows **the real size of the brush**: a
 * circle with the diameter of the thickness, in pixels, since the thickness is now constant on
 * screen. The wheel is relayed to the canvas to keep the orbit zoom.
 *
 * The 2D dotted guide is only shown on the portion of the gesture **that touches no surface**:
 * it says "the ray passes through the void, nothing will be painted here" instead of letting one
 * believe in a stroke. The rest of the time, what is seen is the 3D line itself.
 */
export default function PaintOverlay({
  mode,
  color,
  width,
  getCanvas,
  gesture,
  onErase,
}: {
  mode: PaintTool;
  color: string;
  /** Stroke thickness, in screen pixels. */
  width: number;
  getCanvas: () => HTMLElement | null;
  gesture: StrokeGesture;
  onErase: (point: [number, number], viewport: { width: number; height: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const lastRef = useRef<[number, number] | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  // Portion of the gesture that fell into the void (since the last sample that hit).
  const [miss, setMiss] = useState<[number, number][]>([]);

  const local = (e: PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const viewport = () => ({ width: ref.current!.clientWidth, height: ref.current!.clientHeight });

  const feed = (point: [number, number]) => {
    lastRef.current = point;
    const hit = gesture.sample(point, viewport());
    setMiss((previous) => (hit ? [] : [...previous, point]));
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointer (tests) without possible capture: the gesture still works
    }
    const point = local(e);
    setCursor(point);
    if (mode === 'erase') {
      onErase(point, viewport());
      return;
    }
    drawing.current = true;
    gesture.begin();
    setMiss([]);
    feed(point);
  };

  const onPointerMove = (e: PointerEvent) => {
    const point = local(e);
    setCursor(point);
    if (!drawing.current) return;
    const last = lastRef.current;
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < SAMPLE_STEP) return;
    feed(point);
  };

  const onPointerUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    lastRef.current = null;
    setMiss([]);
    gesture.end();
  };

  const onWheel = (e: WheelEvent) => {
    getCanvas()?.dispatchEvent(new globalThis.WheelEvent('wheel', e.nativeEvent));
  };

  const radius = mode === 'erase' ? ERASE_TOLERANCE_PX : Math.max(width / 2, 1.5);

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-10 cursor-crosshair touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setCursor(null)}
      onWheel={onWheel}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full text-muted-foreground">
        {miss.length > 1 && (
          <polyline
            points={miss.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="3 4"
          />
        )}
        {cursor && (
          <circle
            cx={cursor[0]}
            cy={cursor[1]}
            r={radius}
            fill="none"
            stroke={mode === 'erase' ? 'currentColor' : color}
            strokeWidth={1}
            strokeDasharray={mode === 'erase' ? '4 3' : undefined}
          />
        )}
      </svg>
    </div>
  );
}
