// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CurveKey } from '../channels/model';
import { handleSpanMs, isWeighted, slopeOf, typeOut, type TangentSide } from '../channels/tangents';
import { timeToX, valueToY, type TimeView, type ValueView } from './viewTransform';

/** Screen length of an **unweighted** handle (the weight is meaningless then). */
const HANDLE_PX = 34;

/**
 * Tangent handles of the primary key (Phase 17; split sides Phase 50, batch 7).
 *
 * The handle shows the slope the read **actually** uses (`slopeOf`), not `tout ?? 0`: on a smooth
 * key it was drawn flat while the curve left at a slope — then dragging made the curve jump to
 * that false value. A **weighted** key carries square handles whose length is the weight; the
 * others keep a fixed screen length.
 */
export default function TangentHandles({
  keys,
  index,
  color,
  timeView,
  valueView,
  onStart,
}: {
  keys: readonly CurveKey[];
  index: number;
  color: string;
  timeView: TimeView;
  valueView: ValueView;
  onStart: (e: ReactPointerEvent, side: TangentSide) => void;
}) {
  const k = keys[index];
  const kx = timeToX(k.t, timeView);
  const ky = valueToY(k.v, valueView);
  const weighted = isWeighted(k);
  const msPerPx = (timeView.t1 - timeView.t0) / (timeView.width || 1);
  return (
    <>
      {(['in', 'out'] as const).map((side) => {
        // A step has no shape to adjust on the outgoing side: its handle would be a lie.
        if (side === 'out' && typeOut(k) === 'step') return null;
        const dir = side === 'out' ? 1 : -1;
        const span = handleSpanMs(keys, index, side);
        const dt = dir * (span ?? HANDLE_PX * msPerPx);
        const hx = timeToX(k.t + dt, timeView);
        const hy = valueToY(k.v + slopeOf(keys, index, side) * dt, valueView);
        return (
          <g key={side}>
            <line x1={kx} y1={ky} x2={hx} y2={hy} stroke={color} strokeWidth={1} opacity={0.6} />
            {weighted ? (
              <rect
                x={hx - 3}
                y={hy - 3}
                width={6}
                height={6}
                fill="hsl(var(--card))"
                stroke={color}
                strokeWidth={1.5}
                style={{ cursor: 'move' }}
                onPointerDown={(e) => onStart(e, side)}
              />
            ) : (
              <circle
                cx={hx}
                cy={hy}
                r={3.5}
                fill="hsl(var(--card))"
                stroke={color}
                strokeWidth={1.5}
                style={{ cursor: 'move' }}
                onPointerDown={(e) => onStart(e, side)}
              />
            )}
          </g>
        );
      })}
    </>
  );
}
