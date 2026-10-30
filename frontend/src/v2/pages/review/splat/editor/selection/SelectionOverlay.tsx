// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { normalizeRect, type SelectCombine, type SelectionShape } from './shapes2d';

/** Distance (px) between two consecutive lasso points (limits the polygon size). */
const LASSO_STEP = 3;

/**
 * Selection drawing overlay (10.G): captures the pointer while a selection tool is
 * active, draws the rectangle, lasso or brush cursor in SVG (theme tokens via
 * currentColor) and reports the shape (on release) or the brush strokes (continuously, V3) with
 * the combine mode (Shift = add, Alt = remove; brush: the 1st stroke without a modifier
 * replaces, the following strokes of the same gesture add).
 *
 * **Continuous navigation passes through.** The overlay covers the canvas: anything it does not
 * relay no longer exists for the scene. The wheel already was (orbit zoom); the **right button**
 * was not, so arming a selection tool suppressed both the fly *and* the viewer's context menu.
 * Its events are now replayed on the canvas, and the native menu stays blocked here as elsewhere.
 * The gesture measured on the canvas decides between fly and menu
 * (`viewer/useSpatialContextMenu`), never the overlay.
 */
export default function SelectionOverlay({
  tool,
  brushRadius = 40,
  getCanvas,
  onCommit,
  onBrush,
  onBrushEnd,
}: {
  tool: 'rect' | 'lasso' | 'brush';
  /** Brush radius in pixels (brush tool). */
  brushRadius?: number;
  /** Three canvas (resolved on demand): target of relayed navigation events. */
  getCanvas: () => HTMLElement | null;
  onCommit: (
    shape: SelectionShape,
    combine: SelectCombine,
    viewport: { width: number; height: number },
  ) => void;
  /** Brush stroke (brush tool), called continuously during the drag. */
  onBrush?: (
    point: { x: number; y: number },
    combine: SelectCombine,
    viewport: { width: number; height: number },
  ) => void;
  /**
   * End of the brush stroke (release or pointer lost). This is what makes the stroke **one**
   * history step: without this boundary, the selection would not know where the gesture ends and
   * Ctrl+Z would undo a single stamp out of dozens.
   */
  onBrushEnd?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ start: [number, number]; points: [number, number][] } | null>(null);
  // Brush cursor (tracked outside the drag to show the circle) and combine mode of the current gesture.
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

  /** Is the right button involved (press/release, or held during a move)? */
  const isRightButton = (e: PointerEvent): boolean => e.button === 2 || (e.buttons & 2) !== 0;

  /** Replays the event on the Three canvas: the fly and the context menu receive it. */
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
      // synthetic pointer (tests) without possible capture: the drag still works
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
    // Fly in progress: the gesture belongs to the camera, we do not trace over it.
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
      // After the 1st stroke, the gesture accumulates (a "replace" per move would empty the stroke).
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
      onBrushEnd?.();
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
      if (rect.w < 2 && rect.h < 2) return; // simple click: ignored (no empty selection)
      onCommit({ kind: 'rect', rect }, combine, viewport());
    } else {
      if (drag.points.length < 3) return;
      onCommit({ kind: 'lasso', points: drag.points }, combine, viewport());
    }
  };

  // Relays the wheel to the Three canvas (OrbitControls) to keep the zoom during selection.
  const onWheel = (e: WheelEvent) => {
    getCanvas()?.dispatchEvent(new globalThis.WheelEvent('wheel', e.nativeEvent));
  };

  // The browser's native menu has no place on the viewer, and the overlay serves no menu:
  // the event stops here. The viewer's menu opens from the canvas, on the relayed gesture.
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
      // Pointer lost mid-stroke (capture stolen, system gesture): the stroke still closes,
      // otherwise its history step would stay open and swallow the next stroke.
      onPointerCancel={() => {
        brushStroke.current = null;
        onBrushEnd?.();
      }}
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
