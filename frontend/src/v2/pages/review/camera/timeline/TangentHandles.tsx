// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CurveKey } from '../channels/model';
import { handleSpanMs, isWeighted, slopeOf, typeOut, type TangentSide } from '../channels/tangents';
import { timeToX, valueToY, type TimeView, type ValueView } from './viewTransform';

/** Longueur d'écran d'une poignée **non pondérée** (le poids n'a alors aucun sens). */
const HANDLE_PX = 34;

/**
 * Poignées de tangente de la clé primaire (Phase 17 ; côtés séparés Phase 50, lot 7).
 *
 * La poignée montre la pente que la lecture utilise **vraiment** (`slopeOf`), et non `tout ?? 0` :
 * sur une clé lissée, elle était tracée à plat alors que la courbe partait en pente — puis le drag
 * faisait sauter la courbe sur cette fausse valeur. Une clé **pondérée** porte des poignées carrées
 * dont la longueur est le poids ; les autres gardent une longueur d'écran fixe.
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
        // Un palier n'a pas de forme à régler côté sortant : sa poignée serait un mensonge.
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
