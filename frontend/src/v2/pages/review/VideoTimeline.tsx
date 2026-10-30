// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewComment, TimelineMarker } from '../../types/api';
import Avatar from '../../components/Avatar';
import TimelineOptionsMenu, { type TimelineToggle } from './TimelineOptionsMenu';
import { formatTime } from './reviewTypes';
import { spriteIndexAt, spriteSlotCss, type TimelineSpriteMeta } from './timelineSprite';
import { RangeSegments } from './RangeAnnotations';
import { MarkerDialog, MarkerTicks } from './TimelineMarkers';
import type { TimelineMarkersApi } from './useTimelineMarkers';
import { useT } from '../../i18n';

/** Video timeline: mouse scrubbing + hover thumbnail (the sprite thumbnail under the cursor,
 * YouTube-style) + comment markers with the author's avatar + shared named/colored markers
 * placed by right-click (34.C). */
export default function VideoTimeline({
  currentTime,
  duration,
  comments,
  selectedId,
  onSeek,
  onSelectComment,
  trimRange,
  loop,
  sprite,
  markersApi,
  waveform,
  autoAdvance,
  fps = 24,
  startFrame = 1001,
}: {
  currentTime: number;
  duration: number;
  comments: ReviewComment[];
  selectedId: number | null;
  onSeek: (t: number) => void;
  onSelectComment: (c: ReviewComment) => void;
  /** Trim window (seconds) — areas outside the cut grayed out (10.G-V10). */
  trimRange?: { start: number; end: number } | null;
  /** I/O loop points (seconds, 14.B) — region highlighted between in and out. */
  loop?: { in: number | null; out: number | null };
  /** Thumbnail sprite (~1 thumbnail / 3 s): the one under the cursor is shown on hover. */
  sprite?: { url: string; meta: TimelineSpriteMeta } | null;
  /** Shared markers (34.C) — absent: timeline without markers (B comparison…). */
  markersApi?: TimelineMarkersApi;
  /** Audio waveform display, set via right-click on the bar. */
  waveform?: TimelineToggle;
  /** Automatic playlist chaining, set in the same place. */
  autoAdvance?: TimelineToggle;
  fps?: number;
  startFrame?: number;
}) {
  const t = useT();
  const barRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const [barWidth, setBarWidth] = useState(0);
  // Shared markers (34.C): frame targeted by right-click + create/edit dialog.
  const ctxFrame = useRef(0);
  const [markerDialog, setMarkerDialog] = useState<{ frame: number; editing: TimelineMarker | null } | null>(
    null,
  );
  // Cursor abscissa (px, relative to the bar) — drives the hover thumbnail.
  const [hoverX, setHoverX] = useState<number | null>(null);
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  const timedComments = comments.filter((c) => c.timestamp != null);

  // Tracked bar width, used to size the filmstrip.
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Hover thumbnail: the sprite frame at the pointed instant, centered on the cursor
  // (clamped to the bar's edges).
  const thumbH = 68;
  const thumb =
    sprite && duration > 0 && hoverX != null && barWidth > 0
      ? (() => {
          const time = (hoverX / barWidth) * duration;
          const w = (sprite.meta.tileW / sprite.meta.tileH) * thumbH;
          return {
            time,
            index: spriteIndexAt(time, sprite.meta),
            w,
            left: Math.max(0, Math.min(hoverX - w / 2, barWidth - w)),
          };
        })()
      : null;

  const seekFromEvent = useCallback(
    (e: { clientX: number }) => {
      const bar = barRef.current;
      if (!bar || duration <= 0) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(ratio * duration);
    },
    [duration, onSeek],
  );

  // Scrub: hold the click + drag = continuous movement through the video.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    scrubbing.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekFromEvent(e);
  };
  const trackHover = (e: { clientX: number }) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (rect) setHoverX(Math.max(0, Math.min(e.clientX - rect.left, rect.width)));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    trackHover(e);
    if (scrubbing.current) seekFromEvent(e);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    scrubbing.current = false;
    // End of scrub outside the bar (pointer capture): the thumbnail closes.
    const rect = barRef.current?.getBoundingClientRect();
    if (
      rect &&
      (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
    )
      setHoverX(null);
  };

  // Right-click is only captured if the bar has something to offer: otherwise it must bubble
  // up to the viewer menu, as everywhere else in the review.
  const hasMenu =
    markersApi?.canWrite === true || waveform?.available === true || autoAdvance?.available === true;

  // Right-click on the bar: remembers the pointed frame ("Add a marker here" menu)
  // and does not bubble up to the viewer's global context menu.
  const onBarContextMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    ctxFrame.current = Math.round(ratio * duration * (fps || 24));
  };

  const bar = (
    <div
      ref={barRef}
      className="relative h-9 shrink-0 cursor-pointer select-none rounded-md border border-border bg-card/60 px-1"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerEnter={trackHover}
      onPointerLeave={() => {
        if (!scrubbing.current) setHoverX(null);
      }}
      onContextMenu={hasMenu ? onBarContextMenu : undefined}
      title={t('review.timeline.scrub')}
    >
      {/* Hover thumbnail: the thumbnail at the pointed instant, following the cursor */}
      {thumb && (
        <div
          className="pointer-events-none absolute bottom-full z-30 mb-1.5 overflow-hidden rounded-md border border-border bg-card shadow-lg"
          style={{ left: thumb.left, width: thumb.w }}
        >
          <div
            style={{
              width: thumb.w,
              height: thumbH,
              backgroundImage: `url(${sprite!.url})`,
              backgroundRepeat: 'no-repeat',
              ...spriteSlotCss(thumb.index, sprite!.meta, thumbH),
            }}
          />
          <p className="bg-card/95 py-0.5 text-center font-mono text-2xs text-muted-foreground">
            {formatTime(thumb.time)}
          </p>
        </div>
      )}

      {/* Progress background */}
      <div className="absolute inset-y-0 left-1 right-1 overflow-hidden rounded">
        <div className="h-full rounded bg-secondary/40" />
        <div
          className="absolute inset-y-0 left-0 rounded bg-primary/30 transition-none"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Out-of-trim areas (grayed) — the non-destructive cut, visible at a glance */}
      {trimRange && duration > 0 && (
        <>
          {trimRange.start > 0 && (
            <div
              className="pointer-events-none absolute inset-y-0 left-1 z-[5] rounded-l bg-background/70"
              style={{ width: `${Math.min(trimRange.start / duration, 1) * 100}%` }}
            />
          )}
          {trimRange.end < duration && (
            <div
              className="pointer-events-none absolute inset-y-0 right-1 z-[5] rounded-r bg-background/70"
              style={{ width: `${Math.min(1 - trimRange.end / duration, 1) * 100}%` }}
            />
          )}
        </>
      )}

      {/* I/O loop region (14.B) + handles */}
      {loop && duration > 0 && (loop.in != null || loop.out != null) && (
        <>
          {loop.in != null && loop.out != null && (
            <div
              className="pointer-events-none absolute inset-y-0 z-[6] rounded bg-primary/20"
              style={{
                left: `calc(${(loop.in / duration) * 100}% * (100% - 8px) / 100% + 4px)`,
                width: `${(Math.max(loop.out - loop.in, 0) / duration) * 100}%`,
              }}
            />
          )}
          {(['in', 'out'] as const).map((k) =>
            loop[k] != null ? (
              <div
                key={k}
                className="pointer-events-none absolute inset-y-1 z-[7] w-0.5 rounded-full bg-primary"
                style={{ left: `calc(${(loop[k] / duration) * 100}% * (100% - 8px) / 100% + 4px)` }}
                title={k === 'in' ? t('video.loopIn') : t('video.loopOut')}
              />
            ) : null,
          )}
        </>
      )}

      {/* Playhead */}
      <div
        className="absolute top-0 bottom-0 w-0.5 rounded-full bg-primary z-10 pointer-events-none"
        style={{ left: `calc(${progress * 100}% * (100% - 8px) / 100% + 4px)` }}
      />

      {/* Comment markers: the review author's avatar */}
      {timedComments.map((c) => {
        const pos = (c.timestamp! / duration) * 100;
        const selected = c.id === selectedId;
        return (
          <button
            key={c.id}
            className={`absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform ${
              selected
                ? 'scale-125 ring-2 ring-primary'
                : 'ring-1 ring-primary/50 hover:scale-125 hover:ring-primary'
            }`}
            style={{ left: `calc(${pos}% * (100% - 8px) / 100% + 4px)` }}
            title={`${c.author?.displayName ?? c.author?.name ?? c.guestName ?? t('common.unknown')} : ${c.content.slice(0, 60)}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSelectComment(c);
            }}
          >
            <Avatar
              seed={c.author?.id ?? c.guestName ?? 'g'}
              initials={c.author?.initials ?? (c.guestName ?? '?').slice(0, 2).toUpperCase()}
              avatarUrl={c.author?.avatarUrl}
              size={18}
            />
          </button>
        );
      })}

      {/* Annotated in→out ranges (34.A): thin segment in the author's color + handles */}
      <RangeSegments
        comments={comments}
        duration={duration}
        fps={fps}
        selectedId={selectedId}
        onSelectComment={onSelectComment}
      />

      {/* Shared named/colored markers (34.C) */}
      {markersApi && (
        <MarkerTicks
          api={markersApi}
          duration={duration}
          fps={fps}
          onSeek={onSeek}
          onEdit={(m) => setMarkerDialog({ frame: m.frame, editing: m })}
        />
      )}

      {/* Timecode shown on the right */}
      <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-2xs text-muted-foreground pointer-events-none">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );

  return (
    <>
      <TimelineOptionsMenu
        canAddMarker={markersApi?.canWrite === true}
        onAddMarker={() => setMarkerDialog({ frame: ctxFrame.current, editing: null })}
        waveform={waveform}
        autoAdvance={autoAdvance}
      >
        {bar}
      </TimelineOptionsMenu>
      {markersApi?.canWrite && markerDialog !== null && (
        <MarkerDialog
          key={markerDialog.editing?.id ?? `new-${markerDialog.frame}`}
          onClose={() => setMarkerDialog(null)}
          frame={markerDialog.frame}
          startFrame={startFrame}
          editing={markerDialog.editing}
          api={markersApi}
        />
      )}
    </>
  );
}
