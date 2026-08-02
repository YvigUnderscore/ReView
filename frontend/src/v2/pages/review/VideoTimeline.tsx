// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark } from 'lucide-react';
import type { ReviewComment, TimelineMarker } from '../../types/api';
import Avatar from '../../components/Avatar';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import { formatTime } from './reviewTypes';
import { spriteIndexAt, spriteSlotCss, type TimelineSpriteMeta } from './timelineSprite';
import { RangeSegments } from './RangeAnnotations';
import { MarkerDialog, MarkerTicks } from './TimelineMarkers';
import type { TimelineMarkersApi } from './useTimelineMarkers';

/** Timeline vidéo : scrub à la souris + miniature de survol (la vignette du sprite sous
 * le curseur, façon YouTube) + marqueurs de commentaires avec avatar de l'auteur +
 * marqueurs nommés/colorés partagés posés par clic droit (34.C). */
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
  fps = 24,
  startFrame = 1001,
}: {
  currentTime: number;
  duration: number;
  comments: ReviewComment[];
  selectedId: number | null;
  onSeek: (t: number) => void;
  onSelectComment: (c: ReviewComment) => void;
  /** Fenêtre de trim (secondes) — zones hors coupe grisées (10.G-V10). */
  trimRange?: { start: number; end: number } | null;
  /** Points de boucle I/O (secondes, 14.B) — région surlignée entre in et out. */
  loop?: { in: number | null; out: number | null };
  /** Sprite de miniatures (~1 vignette / 3 s) : celle sous le curseur s'affiche au survol. */
  sprite?: { url: string; meta: TimelineSpriteMeta } | null;
  /** Marqueurs partagés (34.C) — absent : timeline sans marqueurs (comparaison B…). */
  markersApi?: TimelineMarkersApi;
  fps?: number;
  startFrame?: number;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const [barWidth, setBarWidth] = useState(0);
  // Marqueurs partagés (34.C) : frame visée par le clic droit + dialog création/édition.
  const ctxFrame = useRef(0);
  const [markerDialog, setMarkerDialog] = useState<{ frame: number; editing: TimelineMarker | null } | null>(
    null,
  );
  // Abscisse du curseur (px, relative à la barre) — pilote la miniature de survol.
  const [hoverX, setHoverX] = useState<number | null>(null);
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  const timedComments = comments.filter((c) => c.timestamp != null);

  // Largeur de barre suivie pour dimensionner le filmstrip.
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Miniature de survol : la vignette du sprite à l'instant pointé, centrée sur le
  // curseur (clampée aux bords de la barre).
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

  // Scrub : maintien du clic + glissement = déplacement continu dans la vidéo.
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
    // Fin de scrub hors de la barre (pointer capture) : la miniature se referme.
    const rect = barRef.current?.getBoundingClientRect();
    if (
      rect &&
      (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
    )
      setHoverX(null);
  };

  // Clic droit sur la barre : mémorise la frame pointée (menu « Ajouter un marqueur ici »)
  // et ne remonte pas au menu contextuel global du viewer.
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
      onContextMenu={markersApi ? onBarContextMenu : undefined}
      title="Cliquer ou glisser pour se déplacer"
    >
      {/* Miniature de survol : la vignette à l'instant pointé, suivant le curseur */}
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
          <p className="bg-card/95 py-0.5 text-center font-mono text-[10px] text-muted-foreground">
            {formatTime(thumb.time)}
          </p>
        </div>
      )}

      {/* Fond progress */}
      <div className="absolute inset-y-0 left-1 right-1 overflow-hidden rounded">
        <div className="h-full rounded bg-secondary/40" />
        <div
          className="absolute inset-y-0 left-0 rounded bg-primary/30 transition-none"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Zones hors trim (grisées) — la coupe non-destructive visible d'un coup d'œil */}
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

      {/* Région de boucle I/O (14.B) + poignées */}
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
                style={{ left: `calc(${(loop[k]! / duration) * 100}% * (100% - 8px) / 100% + 4px)` }}
                title={k === 'in' ? 'Point de boucle I' : 'Point de boucle O'}
              />
            ) : null,
          )}
        </>
      )}

      {/* Curseur de lecture */}
      <div
        className="absolute top-0 bottom-0 w-0.5 rounded-full bg-primary z-10 pointer-events-none"
        style={{ left: `calc(${progress * 100}% * (100% - 8px) / 100% + 4px)` }}
      />

      {/* Marqueurs de commentaires : avatar de l'auteur de la review */}
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
            title={`${c.author?.displayName ?? c.author?.name ?? c.guestName ?? 'Inconnu'} : ${c.content.slice(0, 60)}`}
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

      {/* Plages annotées in→out (34.A) : segment fin à la couleur de l'auteur + poignées */}
      <RangeSegments
        comments={comments}
        duration={duration}
        fps={fps}
        selectedId={selectedId}
        onSelectComment={onSelectComment}
      />

      {/* Marqueurs nommés/colorés partagés (34.C) */}
      {markersApi && (
        <MarkerTicks
          api={markersApi}
          duration={duration}
          fps={fps}
          onSeek={onSeek}
          onEdit={(m) => setMarkerDialog({ frame: m.frame, editing: m })}
        />
      )}

      {/* Timecode affiché à droite */}
      <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground pointer-events-none">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );

  // Sans API marqueurs (pane B de comparaison) ou sans droit d'écriture : barre nue.
  if (!markersApi?.canWrite) return bar;
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{bar}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setMarkerDialog({ frame: ctxFrame.current, editing: null })}>
            <Bookmark size={14} /> Ajouter un marqueur ici…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {markerDialog !== null && (
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
