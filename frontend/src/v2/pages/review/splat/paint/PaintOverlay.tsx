// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { PaintTool } from './useSplatPaint';
import type { StrokeGesture } from './useStrokeGesture';
import { ERASE_TOLERANCE_PX } from './surfaceTrace';

/** Distance (px) entre deux échantillons du trait — un raycast de surface par échantillon. */
const SAMPLE_STEP = 6;

/**
 * Overlay de la brosse de surface 3D : capte le geste, le remonte échantillon par échantillon
 * (le hook raycaste et construit le trait 3D dans la foulée) et montre **la taille réelle de la
 * brosse** — un cercle du diamètre de l'épaisseur, en pixels, puisque l'épaisseur est désormais
 * constante à l'écran. La molette est relayée au canvas pour conserver le zoom d'orbite.
 *
 * Le guide pointillé 2D ne s'affiche que sur la portion du geste **qui ne touche aucune
 * surface** : il dit « le rayon passe dans le vide, rien ne sera peint ici » au lieu de laisser
 * croire à un trait. Le reste du temps, ce qu'on voit est la ligne 3D elle-même.
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
  /** Épaisseur du trait, en pixels d'écran. */
  width: number;
  getCanvas: () => HTMLElement | null;
  gesture: StrokeGesture;
  onErase: (point: [number, number], viewport: { width: number; height: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const lastRef = useRef<[number, number] | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  // Portion du geste tombée dans le vide (depuis le dernier échantillon qui a touché).
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
      // pointeur synthétique (tests) sans capture possible — le geste fonctionne quand même
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
