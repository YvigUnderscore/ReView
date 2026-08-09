// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, FileWarning } from 'lucide-react';
import { reviewPath } from '../../lib/slug';
import { formatDuration } from '../review/timelineNav';
import { sequenceSpans, sequenceStarts, trackLayout } from './timelinePlayback';
import type { TimelineClip } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Le montage entier sur UNE bande (Phase 46).
 *
 * Tous les plans y sont, les uns à la suite des autres, séquences comprises : la largeur
 * d'un plan est sa durée, la tête de lecture court d'un bout à l'autre, et cliquer
 * n'importe où y emmène le film. Il n'y a donc plus ni liste de vignettes d'un côté ni
 * réglette de l'autre — c'était le même objet montré deux fois, et rien ne disait que la
 * bande continuait par-delà la séquence affichée.
 *
 * Les trous ne sont pas masqués : un plan sans média tient sa place, à sa durée, en ambre.
 * Un montage qui saute ses trous prétend être complet.
 */
export default function TimelineTrack({
  items,
  total,
  time,
  currentIndex,
  onSeek,
  timelineId,
  linkToReview = true,
  markers = [],
  selectedMarkerId = null,
  onMarkerClick,
}: {
  items: TimelineClip[];
  total: number;
  time: number;
  currentIndex: number;
  onSeek: (t: number) => void;
  timelineId: number;
  /** Raccourci « ouvrir ce plan en review » au survol — inutile quand le clic y mène déjà. */
  linkToReview?: boolean;
  /** Retours posés sur le montage, à leur position dans le film (Phase 46). */
  markers?: { id: number; time: number; label: string; shared: boolean }[];
  selectedMarkerId?: number | null;
  onMarkerClick?: (id: number) => void;
}) {
  const t = useT();
  const barRef = useRef<HTMLDivElement>(null);
  const spans = sequenceSpans(items);
  const slots = trackLayout(items, total);
  const starts = new Set(sequenceStarts(items));
  const pct = (v: number) => (total > 0 ? Math.min(100, Math.max(0, (v / total) * 100)) : 0);

  const seekFromEvent = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    onSeek(ratio * total);
  };

  if (items.length === 0) return null;

  return (
    <div className="select-none">
      {/* Bandes de séquences : la teinte alterne, le code reste lisible en projection. */}
      <div className="relative mb-0.5 h-4 w-full">
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
        className="relative h-16 w-full cursor-pointer overflow-hidden rounded bg-secondary/30"
      >
        {slots.map(({ index, leftPct, widthPct }) => {
          const clip = items[index]!;
          return (
            <div
              key={clip.shotId}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              title={`${clip.shotCode} · ${clip.shotName}`}
              className={`group absolute top-0 h-16 overflow-hidden ${
                // Le changement de séquence est plus marqué que le changement de plan.
                starts.has(index) ? 'border-l-2 border-primary/80' : 'border-l border-border/60'
              } ${clip.placeholder ? 'bg-amber-500/10' : ''} ${
                index === currentIndex ? 'ring-1 ring-inset ring-primary' : ''
              }`}
            >
              {clip.thumbnailUrl ? (
                <img src={clip.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <FileWarning
                    size={14}
                    className={clip.placeholder ? 'text-amber-500' : 'text-muted-foreground'}
                  />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-baseline justify-between gap-1 bg-background/80 px-1 text-[9px]">
                <span className="truncate font-medium">{clip.shotCode}</span>
                <span className="tabular-nums text-muted-foreground">{formatDuration(clip.duration)}</span>
              </div>
              {clip.durationMismatch && (
                <span
                  title={t('timeline.durationMismatch')}
                  className="absolute right-0.5 top-0.5 text-amber-400"
                >
                  <AlertTriangle size={10} />
                </span>
              )}
              {clip.mediaId !== null && linkToReview && (
                <Link
                  to={`${reviewPath({ id: clip.mediaId, originalName: clip.mediaName })}?timeline=${timelineId}`}
                  // Sans cela, ouvrir la review déplacerait aussi la tête de lecture.
                  onPointerDown={(e) => e.stopPropagation()}
                  title={t('timeline.openInReview')}
                  className="absolute left-0.5 top-0.5 rounded bg-background/80 p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                >
                  <ExternalLink size={10} />
                </Link>
              )}
            </div>
          );
        })}
        {/* Retours du montage : posés sur la même échelle que le film, donc lisibles d'un
            coup d'œil — c'est tout l'intérêt d'une timeline unique. */}
        {markers.map((m) => (
          <button
            key={m.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              onMarkerClick?.(m.id);
            }}
            title={m.label}
            style={{ left: `calc(${pct(m.time)}% - 5px)` }}
            className={`absolute bottom-4 h-2.5 w-2.5 rotate-45 border ${
              m.id === selectedMarkerId
                ? 'border-foreground bg-foreground'
                : m.shared
                  ? 'border-primary bg-primary'
                  : 'border-primary bg-background'
            }`}
          />
        ))}
        <div
          className="pointer-events-none absolute top-0 h-16 w-0.5 bg-foreground"
          style={{ left: `${pct(time)}%` }}
        />
      </div>
    </div>
  );
}
