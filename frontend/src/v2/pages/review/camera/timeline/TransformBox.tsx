// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PointerEvent as ReactPointerEvent } from 'react';
import type { KeyBounds } from '../channels/scaleKeys';
import { timeToX, valueToY, type TimeView, type ValueView } from './viewTransform';

/** Côté saisi, et donc pivot : l'arête opposée reste fixe. */
export type ScaleGrip = 'left' | 'right' | 'top' | 'bottom' | 'corner';

const GRIP = 5;
/** Écart entre le cadre et ses poignées, en pixels. */
const OUTSET = 7;

/**
 * Boîte de transformation d'une sélection de clés (Phase 50, lot 7) : un cadre autour des clés
 * sélectionnées, avec des poignées d'arête qui les **mettent à l'échelle** — dans le temps
 * (retimer un mouvement sans en changer la forme) ou en valeur (amplifier ou tasser une courbe).
 * L'arête opposée à celle qu'on tire sert de pivot, comme dans un curve editor de DCC.
 *
 * Les poignées d'un axe sans étendue (toutes les clés au même temps, ou à la même valeur) ne sont
 * pas dessinées : leur facteur d'échelle n'aurait pas de sens.
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
  // L'axe des valeurs est inversé : la valeur maximale est en haut de l'écran.
  const yTop = valueToY(bounds.vMax, valueView);
  const yBottom = valueToY(bounds.vMin, valueView);
  const hasTime = bounds.tMax > bounds.tMin;
  const hasValue = bounds.vMax > bounds.vMin;
  const midX = (x0 + x1) / 2;
  const midY = (yTop + yBottom) / 2;

  // Les poignées se posent JUSTE À CÔTÉ du cadre : sur le cadre, celle du coin recouvrirait la clé
  // qui tient les deux extrêmes, et la prendrait au clic à sa place.
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
