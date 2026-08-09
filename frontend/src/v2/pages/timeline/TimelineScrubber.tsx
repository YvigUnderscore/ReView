// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { sequenceSpans } from './timelinePlayback';
import type { TimelineClip } from '../../types/api';

/**
 * Barre de temps d'un montage entier (Phase 46).
 *
 * Une seule barre de zéro à la fin du film, découpée par ce qu'elle contient : un trait
 * fin à chaque changement de plan, une bande alternée et un trait franc à chaque
 * changement de séquence. On voit donc en permanence où l'on est, sans que rien
 * n'interrompe l'image — les repères sont sur la réglette, pas sur le film.
 */
export default function TimelineScrubber({
  items,
  total,
  time,
  currentIndex,
  onSeek,
}: {
  items: TimelineClip[];
  total: number;
  time: number;
  currentIndex: number;
  onSeek: (t: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const spans = sequenceSpans(items);
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  const seekFromEvent = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    onSeek(ratio * total);
  };

  return (
    <div className="select-none">
      {/* Bandes de séquences : la teinte alterne, le nom reste lisible en projection. */}
      <div className="relative mb-1 h-4 w-full">
        {spans.map((span, i) => (
          <div
            key={`${span.sequenceId ?? 'none'}-${span.startTime}`}
            className={`absolute top-0 flex h-4 items-center overflow-hidden rounded-sm px-1 text-[10px] ${
              i % 2 === 0 ? 'bg-secondary/70 text-foreground' : 'bg-secondary/30 text-muted-foreground'
            }`}
            style={{ left: `${pct(span.startTime)}%`, width: `${pct(span.duration)}%` }}
            title={span.sequenceCode ?? ''}
          >
            <span className="truncate">{span.sequenceCode ?? '—'}</span>
          </div>
        ))}
      </div>

      <div
        ref={barRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seekFromEvent(e.clientX);
        }}
        className="relative h-6 w-full cursor-pointer rounded bg-secondary/40"
      >
        {items.map((clip, i) => (
          <div
            key={clip.shotId}
            className={`absolute top-0 h-6 border-l ${
              clip.placeholder ? 'bg-amber-500/15' : ''
            } ${i === currentIndex ? 'border-primary bg-primary/10' : 'border-border/70'}`}
            style={{ left: `${pct(clip.startTime)}%`, width: `${pct(clip.duration)}%` }}
            title={`${clip.shotCode}${clip.versionName ? ` · ${clip.versionName}` : ''}`}
          />
        ))}
        {/* Frontières de séquences : plus marquées que celles des plans. */}
        {spans.slice(1).map((span) => (
          <div
            key={`sep-${span.startTime}`}
            className="absolute top-0 h-6 w-0.5 bg-primary/70"
            style={{ left: `${pct(span.startTime)}%` }}
          />
        ))}
        <div
          className="pointer-events-none absolute top-0 h-6 w-0.5 bg-foreground"
          style={{ left: `${pct(time)}%` }}
        />
      </div>
    </div>
  );
}
