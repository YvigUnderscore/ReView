// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { niceTicks } from './gridTicks';
import { rulerTicks, timeToX, valueToY, type TimeView, type ValueView } from './viewTransform';

/**
 * Grille de fond du graph editor (Phase 27) : lignes verticales (temps) et horizontales (valeur),
 * graduations « rondes » (`niceTicks`) pour les valeurs. Couleurs = tokens du thème. Purement
 * visuelle (aucune interaction) — rendue sous les courbes.
 *
 * Les verticales sont **celles de la règle de temps** (`rulerTicks`), et ne portent aucun libellé :
 * le tiroir affichait deux systèmes de graduations temporelles concurrents — timecode `s:ff` dans
 * la règle, secondes décimales dans le graphe — qui ne tombaient jamais aux mêmes endroits. Le
 * timecode reste lu une seule fois, dans la règle, juste au-dessus.
 */
export default function CurveGrid({
  timeView,
  valueView,
  width,
  height,
  fps,
}: {
  timeView: TimeView;
  valueView: ValueView;
  width: number;
  height: number;
  /** Framerate du pipeline — la grille tombe sur les mêmes graduations que la règle. */
  fps: number;
}) {
  const tv: TimeView = { ...timeView, width };
  const vv: ValueView = { ...valueView, height };
  const ticks = rulerTicks(tv, fps);
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
      {ticks.minor.map((t) => (
        <line
          key={`n${t}`}
          x1={timeToX(t, tv)}
          x2={timeToX(t, tv)}
          y1={0}
          y2={height}
          stroke="hsl(var(--border))"
          strokeWidth={0.5}
          opacity={0.22}
        />
      ))}
      {ticks.major.map(({ t }) => (
        <line
          key={`t${t}`}
          x1={timeToX(t, tv)}
          x2={timeToX(t, tv)}
          y1={0}
          y2={height}
          stroke="hsl(var(--border))"
          strokeWidth={0.5}
          opacity={0.55}
        />
      ))}
    </g>
  );
}
