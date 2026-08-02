// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { niceTicks } from './gridTicks';
import { timeToX, valueToY, type TimeView, type ValueView } from './viewTransform';

/**
 * Grille de fond du graph editor (Phase 27) : lignes verticales (temps, libellé en secondes) et
 * horizontales (valeur), graduations « rondes » (`niceTicks`). Couleurs = tokens du thème. Purement
 * visuelle (aucune interaction) — rendue sous les courbes.
 */
export default function CurveGrid({
  timeView,
  valueView,
  width,
  height,
}: {
  timeView: TimeView;
  valueView: ValueView;
  width: number;
  height: number;
}) {
  const tv: TimeView = { ...timeView, width };
  const vv: ValueView = { ...valueView, height };
  const timeTicks = niceTicks(tv.t0, tv.t1, 8);
  const valueTicks = niceTicks(vv.v0, vv.v1, 5);
  return (
    <g pointerEvents="none">
      {valueTicks.map((v) => {
        const y = valueToY(v, vv);
        return (
          <g key={`v${v}`}>
            <line
              x1={0}
              x2={width}
              y1={y}
              y2={y}
              stroke="hsl(var(--border))"
              strokeWidth={0.5}
              opacity={0.5}
            />
            <text x={2} y={y - 1.5} fontSize={9} fill="hsl(var(--muted-foreground))">
              {v}
            </text>
          </g>
        );
      })}
      {timeTicks.map((t) => {
        const x = timeToX(t, tv);
        return (
          <g key={`t${t}`}>
            <line
              x1={x}
              x2={x}
              y1={0}
              y2={height}
              stroke="hsl(var(--border))"
              strokeWidth={0.5}
              opacity={0.5}
            />
            <text x={x + 2} y={height - 2} fontSize={9} fill="hsl(var(--muted-foreground))">
              {(t / 1000).toFixed(t % 1000 === 0 ? 0 : 1)}s
            </text>
          </g>
        );
      })}
    </g>
  );
}
