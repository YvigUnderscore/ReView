import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewComment } from '../../types/api';
import Avatar from '../../components/Avatar';
import { formatTime } from './reviewTypes';
import { filmstripSlots, spriteSlotCss, type TimelineSpriteMeta } from './timelineSprite';

/** Timeline vidéo : scrub à la souris + filmstrip de miniatures (sprite worker,
 * affiché **au survol** en bandeau flottant) + marqueurs de commentaires avec avatar. */
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
  onScrubStart,
  onScrubEnd,
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
  /** Sprite de miniatures (~1 vignette / 3 s) affiché au survol de la timeline. */
  sprite?: { url: string; meta: TimelineSpriteMeta } | null;
  /** Début/fin du glissement — le lecteur bascule en basse qualité pendant le scrub. */
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const [barWidth, setBarWidth] = useState(0);
  const [hovered, setHovered] = useState(false);
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

  const stripH = 40; // hauteur px du filmstrip flottant
  const showStrip = !!sprite && duration > 0 && hovered;
  const slots = showStrip ? filmstripSlots(barWidth - 8, stripH, duration, sprite!.meta) : [];

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
    onScrubStart?.();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekFromEvent(e);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    setHovered(true);
    if (scrubbing.current) seekFromEvent(e);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current) onScrubEnd?.();
    scrubbing.current = false;
    // Fin de scrub hors de la barre (pointer capture) : le filmstrip se referme.
    const rect = barRef.current?.getBoundingClientRect();
    if (
      rect &&
      (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
    )
      setHovered(false);
  };

  return (
    <div
      ref={barRef}
      className="relative h-9 shrink-0 cursor-pointer select-none rounded-md border border-border bg-card/60 px-1"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        if (!scrubbing.current) setHovered(false);
      }}
      title="Cliquer ou glisser pour se déplacer"
    >
      {/* Filmstrip flottant : miniatures visibles uniquement au survol / pendant le scrub */}
      {showStrip && slots.length > 0 && (
        <div className="pointer-events-none absolute bottom-full left-0 right-0 z-30 mb-1 rounded-md border border-border bg-card/95 p-1 shadow-lg backdrop-blur">
          <div className="flex justify-between overflow-hidden rounded">
            {slots.map((idx, i) => (
              <div
                key={i}
                className="shrink-0"
                style={{
                  width: (sprite!.meta.tileW / sprite!.meta.tileH) * stripH,
                  height: stripH,
                  backgroundImage: `url(${sprite!.url})`,
                  backgroundRepeat: 'no-repeat',
                  ...spriteSlotCss(idx, sprite!.meta, stripH),
                }}
              />
            ))}
          </div>
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

      {/* Timecode affiché à droite */}
      <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground pointer-events-none">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );
}
