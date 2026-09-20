// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { normalizeRect, type SelectCombine, type SelectionShape } from './shapes2d';

/** Distance (px) entre deux points consécutifs du lasso (limite la taille du polygone). */
const LASSO_STEP = 3;

/**
 * Overlay de tracé de sélection (10.G) : capte le pointeur quand un outil de sélection est
 * actif, dessine le rectangle, le lasso ou le curseur du pinceau en SVG (tokens de thème via
 * currentColor) et remonte la forme (au lâcher) ou les coups de pinceau (en continu, V3) avec
 * le mode de combinaison (Maj = ajouter, Alt = retirer ; pinceau : le 1ᵉʳ coup sans modificateur
 * remplace, les suivants du même geste ajoutent).
 *
 * **La navigation continue de passer.** L'overlay couvre le canvas : tout ce qu'il ne relaie pas
 * n'existe plus pour la scène. La molette l'était déjà (zoom d'orbite) ; le **bouton droit** ne
 * l'était pas, si bien qu'armer un outil de sélection supprimait le vol *et* le menu contextuel
 * du viewer. Ses événements sont désormais rejoués sur le canvas, et le menu natif reste bloqué
 * ici comme là-bas — c'est le geste mesuré côté canvas qui décide entre vol et menu
 * (`viewer/useSpatialContextMenu`), jamais l'overlay.
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
  /** Canvas Three (résolu à la demande) : cible des événements de navigation relayés. */
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

  /** Le bouton droit est-il en cause (appui/relâchement, ou maintenu pendant un mouvement) ? */
  const isRightButton = (e: PointerEvent): boolean => e.button === 2 || (e.buttons & 2) !== 0;

  /** Rejoue l'événement sur le canvas Three : le vol et le menu contextuel le reçoivent. */
  const relay = (type: 'pointerdown' | 'pointermove' | 'pointerup', e: PointerEvent): void => {
    getCanvas()?.dispatchEvent(new globalThis.PointerEvent(type, e.nativeEvent));
  };

  const onPointerDown = (e: PointerEvent) => {
    if (isRightButton(e)) {
      relay('pointerdown', e);
      return;
    }
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
    // Vol en cours : le geste appartient à la caméra, on ne trace pas par-dessus.
    if (isRightButton(e)) {
      relay('pointermove', e);
      return;
    }
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
      const last = d.points[d.points.length - 1];
      const dist = Math.hypot(p[0] - last[0], p[1] - last[1]);
      return dist >= LASSO_STEP ? { ...d, points: [...d.points, p] } : d;
    });
  };

  const onPointerUp = (e: PointerEvent) => {
    if (isRightButton(e)) {
      relay('pointerup', e);
      return;
    }
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

  // Le menu natif du navigateur n'a pas sa place sur le viewer, et l'overlay ne sert aucun menu :
  // l'événement s'arrête ici. Le menu du viewer s'ouvre depuis le canvas, sur le geste relayé.
  const onContextMenu = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
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
      onContextMenu={onContextMenu}
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
