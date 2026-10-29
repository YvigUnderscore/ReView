// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PointerEvent as ReactPointerEvent } from 'react';
import type { KeyBounds } from '../channels/scaleKeys';
import { timeToX, valueToY, type TimeView, type ValueView } from './viewTransform';

/** Grabbed side, and therefore pivot: the opposite edge stays fixed. */
export type ScaleGrip = 'left' | 'right' | 'top' | 'bottom' | 'corner';

const GRIP = 5;
/** Gap between the frame and its handles, in pixels. */
const OUTSET = 7;

/**
 * Transform box of a key selection (Phase 50, batch 7): a frame around the selected keys, with
 * edge handles that **scale** them — in time (retime a movement without changing its shape) or in
 * value (amplify or flatten a curve). The edge opposite the one being dragged serves as the pivot,
 * as in a DCC curve editor.
 *
 * Handles on an axis with no extent (all keys at the same time, or at the same value) are not
 * drawn: their scale factor would be meaningless.
 */
export default function TransformBox({
  bounds,
  timeView,
  valueView,
  onGrip,
}: {
  bounds: KeyBounds;
  timeView: TimeView;
  valueView: ValueView;
  onGrip: (e: ReactPointerEvent, grip: ScaleGrip) => void;
}) {
  const x0 = timeToX(bounds.tMin, timeView);
  const x1 = timeToX(bounds.tMax, timeView);
  // The value axis is inverted: the maximum value is at the top of the screen.
  const yTop = valueToY(bounds.vMax, valueView);
  const yBottom = valueToY(bounds.vMin, valueView);
  const hasTime = bounds.tMax > bounds.tMin;
  const hasValue = bounds.vMax > bounds.vMin;
  const midX = (x0 + x1) / 2;
  const midY = (yTop + yBottom) / 2;

  // Handles sit JUST NEXT TO the frame: on the frame, the corner one would overlap the key that
  // holds the two extremes, and would capture the click in its place.
  const grips: Array<{ id: ScaleGrip; x: number; y: number; cursor: string; on: boolean }> = [
    { id: 'left', x: x0 - OUTSET, y: midY, cursor: 'ew-resize', on: hasTime },
    { id: 'right', x: x1 + OUTSET, y: midY, cursor: 'ew-resize', on: hasTime },
    { id: 'top', x: midX, y: yTop - OUTSET, cursor: 'ns-resize', on: hasValue },
    { id: 'bottom', x: midX, y: yBottom + OUTSET, cursor: 'ns-resize', on: hasValue },
    { id: 'corner', x: x1 + OUTSET, y: yTop - OUTSET, cursor: 'nesw-resize', on: hasTime && hasValue },
  ];

  return (
    <g>
      <rect
        x={Math.min(x0, x1)}
        y={Math.min(yTop, yBottom)}
        width={Math.abs(x1 - x0)}
        height={Math.abs(yBottom - yTop)}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.7}
        pointerEvents="none"
      />
      {grips
        .filter((g) => g.on)
        .map((g) => (
          <rect
            key={g.id}
            x={g.x - GRIP / 2}
            y={g.y - GRIP / 2}
            width={GRIP}
            height={GRIP}
            fill="hsl(var(--primary))"
            stroke="hsl(var(--card))"
            strokeWidth={1}
            style={{ cursor: g.cursor }}
            onPointerDown={(e) => onGrip(e, g.id)}
          />
        ))}
    </g>
  );
}
