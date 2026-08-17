// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef } from 'react';
import Avatar from '../../components/Avatar';
import { formatTime } from '../review/reviewTypes';
import { sequenceSpans, sequenceStarts, trackLayout } from './timelinePlayback';
import type { MontageComment } from './montageFeedback';
import type { TimelineClip } from '../../types/api';
import { useT } from '../../i18n';

/**
 * La timeline du montage — même barre que celle du lecteur de review, à ceci près qu'elle
 * porte le film entier (Phase 46).
 *
 * Une seule échelle, de zéro à la fin : les plans y occupent leur durée, les séquences se
 * lisent à la bande du dessus et à la frontière franche qui les sépare, et les retours s'y
 * épinglent comme en review, avec l'avatar de leur auteur. Rien d'autre n'est inventé —
 * l'apparence, le scrub et les repères sont ceux de la review, pour que la page se lise
 * sans réapprentissage.
 */
export default function MontageTimeline({
  items,
  total,
  time,
  currentIndex,
  comments,
  selectedId,
  onSeek,
  onSelectComment,
}: {
  items: TimelineClip[];
  total: number;
  time: number;
  currentIndex: number;
  comments: MontageComment[];
  selectedId: number | null;
  onSeek: (t: number) => void;
  onSelectComment: (c: MontageComment) => void;
}) {
  const t = useT();
  const barRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const spans = sequenceSpans(items);
  const slots = trackLayout(items, total);
  const starts = new Set(sequenceStarts(items));
  const progress = total > 0 ? Math.min(time / total, 1) : 0;
  const pct = (v: number) => (total > 0 ? Math.min(100, Math.max(0, (v / total) * 100)) : 0);
  // Même calage que la review : la barre a 4 px de marge intérieure de chaque côté.
  const anchor = (v: number) => `calc(${pct(v)}% * (100% - 8px) / 100% + 4px)`;

  const seekFromEvent = useCallback(
    (e: { clientX: number }) => {
      const bar = barRef.current;
      if (!bar || total <= 0) return;
      const rect = bar.getBoundingClientRect();
      onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * total);
    },
    [total, onSeek],
  );

  if (items.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-col gap-1">
      {/* Bande des séquences : la respiration du film, au-dessus des plans. */}
      <div className="relative h-4 w-full px-1">
        {spans.map((span, i) => (
          <div
            key={`${span.sequenceId ?? 'none'}-${span.startTime}`}
            className={`absolute top-0 flex h-4 items-center overflow-hidden rounded-sm px-1 text-[10px] ${
              i % 2 === 0 ? 'bg-secondary/70 text-foreground' : 'bg-secondary/30 text-muted-foreground'
            }`}
            style={{ left: anchor(span.startTime), width: `${pct(span.duration)}%` }}
            title={span.sequenceCode ?? ''}
          >
            <span className="truncate">{span.sequenceCode ?? '—'}</span>
          </div>
        ))}
      </div>

      <div
        ref={barRef}
        className="relative h-9 shrink-0 cursor-pointer select-none rounded-md border border-border bg-card/60 px-1"
        title={t('review.timeline.scrub')}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          scrubbing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e);
        }}
        onPointerMove={(e) => {
          if (scrubbing.current) seekFromEvent(e);
        }}
        onPointerUp={() => {
          scrubbing.current = false;
        }}
      >
        <div className="absolute inset-y-0 left-1 right-1 overflow-hidden rounded">
          <div className="h-full rounded bg-secondary/40" />
          {/* Les plans à leur durée : c'est ce qui fait d'une barre de temps un montage. */}
          {slots.map(({ index, leftPct, widthPct }) => {
            const clip = items[index];
            return (
              <div
                key={clip.shotId}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                title={`${clip.sequenceCode ? `${clip.sequenceCode} · ` : ''}${clip.shotCode}${
                  clip.versionName ? ` · ${clip.versionName}` : ''
                }`}
                className={`absolute inset-y-0 ${
                  starts.has(index) ? 'border-l border-primary/70' : 'border-l border-border/60'
                } ${clip.placeholder ? 'bg-warning/20' : index % 2 === 0 ? 'bg-foreground/[0.04]' : ''} ${
                  index === currentIndex ? 'bg-primary/10' : ''
                }`}
              />
            );
          })}
          <div
            className="absolute inset-y-0 left-0 rounded bg-primary/30 transition-none"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Curseur de lecture — même trait que la review. */}
        <div
          className="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 rounded-full bg-primary"
          style={{ left: anchor(time) }}
        />

        {/* Retours du montage : épinglés à l'avatar de leur auteur, comme en review. */}
        {comments
          .filter((c) => c.timelineTime != null)
          .map((c) => (
            <button
              key={c.id}
              className={`absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform ${
                c.id === selectedId
                  ? 'scale-125 ring-2 ring-primary'
                  : 'ring-1 ring-primary/50 hover:scale-125 hover:ring-primary'
              }`}
              style={{ left: anchor(c.timelineTime!) }}
              title={`${c.author?.displayName ?? c.author?.name ?? '—'} : ${c.content
                .replace(/<[^>]*>/g, ' ')
                .slice(0, 60)}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSelectComment(c);
              }}
            >
              <Avatar
                seed={c.author?.id ?? 'g'}
                initials={c.author?.initials ?? '?'}
                avatarUrl={c.author?.avatarUrl}
                size={18}
              />
            </button>
          ))}

        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground">
          {formatTime(time)} / {formatTime(total)}
        </span>
      </div>
    </div>
  );
}
