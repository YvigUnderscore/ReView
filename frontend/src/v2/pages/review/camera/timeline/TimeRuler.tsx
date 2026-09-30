// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { rulerTicks, snapToFrame, timeToX, xToTime, type TimeView } from './viewTransform';

export const RULER_HEIGHT = 22;

/**
 * Règle temporelle graduée du séquenceur caméra : timecode `s:ff` aux graduations majeures,
 * frames en ticks mineurs, losanges des clés (tous canaux confondus) et tête de lecture.
 * **Scrub au drag** (capture du pointeur, snap à la frame — Alt pour libérer), molette = zoom
 * comme le graph. Partage la `TimeView` du graph editor : clés et courbes restent alignées.
 */
export default function TimeRuler({
  view,
  fps,
  keyTimes,
  playheadT,
  guideT,
  editable,
  onScrub,
  onZoom,
  onBeginStroke,
  onMoveColumn,
  onRemoveColumn,
}: {
  view: TimeView;
  fps: number;
  keyTimes: readonly number[];
  playheadT: number;
  /** Fin de lecture (durée réglée) — repère pointillé, comme dans le graph. */
  guideT?: number;
  /** Colonnes du dopesheet éditables : drag = retimer, Alt+clic = supprimer. */
  editable?: boolean;
  onScrub: (t: number) => void;
  onZoom?: (pivotT: number, factor: number) => void;
  onBeginStroke?: () => void;
  /** Retime en direct la colonne de clés `fromT` vers `toT` (drag d'un losange). */
  onMoveColumn?: (fromT: number, toT: number) => void;
  /** Supprime toutes les clés de la colonne `t` (Alt+clic sur un losange). */
  onRemoveColumn?: (t: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: 'scrub' } | { kind: 'column'; t: number } | null>(null);
  const ticks = rulerTicks(view, fps);

  const localX = (clientX: number) => clientX - (svgRef.current?.getBoundingClientRect().left ?? 0);
  const timeAt = (clientX: number, raw: boolean) => {
    const t = Math.max(0, xToTime(localX(clientX), view));
    return raw ? t : snapToFrame(t, fps);
  };
  const scrubAt = (clientX: number, raw: boolean) => onScrub(timeAt(clientX, raw));

  const px = timeToX(playheadT, view);
  return (
    <svg
      ref={svgRef}
      width={view.width}
      height={RULER_HEIGHT}
      className="block shrink-0 touch-none select-none"
      style={{ cursor: 'ew-resize' }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { kind: 'scrub' };
        (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
        scrubAt(e.clientX, e.altKey);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (d.kind === 'scrub') scrubAt(e.clientX, e.altKey);
        else {
          const to = timeAt(e.clientX, e.altKey);
          onMoveColumn?.(d.t, to);
          d.t = to;
        }
      }}
      onPointerUp={(e) => {
        drag.current = null;
        (e.currentTarget as SVGElement).releasePointerCapture?.(e.pointerId);
      }}
      onWheel={(e) => onZoom?.(xToTime(localX(e.clientX), view), e.deltaY < 0 ? 0.85 : 1.18)}
    >
      <rect x={0} y={0} width={view.width} height={RULER_HEIGHT} fill="hsl(var(--secondary) / 0.35)" />
      {ticks.minor.map((t) => (
        <line
          key={`m${t}`}
          x1={timeToX(t, view)}
          x2={timeToX(t, view)}
          y1={RULER_HEIGHT - 5}
          y2={RULER_HEIGHT}
          stroke="hsl(var(--muted-foreground))"
          strokeWidth={1}
          opacity={0.35}
        />
      ))}
      {ticks.major.map(({ t, label }) => (
        <g key={t}>
          <line
            x1={timeToX(t, view)}
            x2={timeToX(t, view)}
            y1={RULER_HEIGHT - 9}
            y2={RULER_HEIGHT}
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={1}
            opacity={0.7}
          />
          <text
            x={timeToX(t, view) + 3}
            y={9}
            fontSize={9}
            fill="hsl(var(--muted-foreground))"
            fontFamily="ui-monospace, monospace"
          >
            {label}
          </text>
        </g>
      ))}
      {guideT != null && guideT > 0 && (
        <line
          x1={timeToX(guideT, view)}
          x2={timeToX(guideT, view)}
          y1={0}
          y2={RULER_HEIGHT}
          stroke="hsl(var(--muted-foreground))"
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0.7}
        />
      )}
      {keyTimes.map((t) => (
        <path
          key={`k${t}`}
          d={`M${timeToX(t, view).toFixed(1)} ${RULER_HEIGHT - 12} l4 4 l-4 4 l-4 -4 Z`}
          fill="hsl(var(--primary))"
          opacity={0.9}
          style={editable ? { cursor: 'grab' } : undefined}
          onPointerDown={
            editable
              ? (e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  // Alt+clic = supprimer la colonne ; sinon drag = retimer toutes les clés du temps.
                  if (e.altKey) {
                    onRemoveColumn?.(t);
                    return;
                  }
                  onBeginStroke?.();
                  drag.current = { kind: 'column', t };
                  (e.currentTarget.ownerSVGElement as SVGElement).setPointerCapture(e.pointerId);
                }
              : undefined
          }
        />
      ))}
      <g>
        <line x1={px} x2={px} y1={0} y2={RULER_HEIGHT} stroke="hsl(var(--primary))" strokeWidth={1.5} />
        <path d={`M${px - 4} 0 h8 l-4 6 Z`} fill="hsl(var(--primary))" />
      </g>
    </svg>
  );
}
