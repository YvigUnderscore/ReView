// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { niceTicks } from './gridTicks';
import { rulerTicks, timeToX, valueToY, type TimeView, type ValueView } from './viewTransform';

/**
 * Graph editor background grid (Phase 27): vertical lines (time) and horizontal lines (value),
 * "round" ticks (`niceTicks`) for the values. Colors = theme tokens. Purely visual (no
 * interaction) — rendered under the curves.
 *
 * The verticals are **those of the time ruler** (`rulerTicks`), and carry no label: the drawer
 * used to show two competing time tick systems — `s:ff` timecode on the ruler, decimal seconds
 * on the graph — that never fell at the same places. The timecode is now read once, on the
 * ruler, just above.
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
  /** Pipeline frame rate — the grid falls on the same ticks as the ruler. */
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
