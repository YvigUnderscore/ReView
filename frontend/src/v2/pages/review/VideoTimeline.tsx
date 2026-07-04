import { useCallback, useRef } from 'react';
import type { ReviewComment } from '../../types/api';
import { formatTime } from './reviewTypes';

/** Timeline vidéo avec marqueurs de commentaires horodatés. */
export default function VideoTimeline({
  currentTime,
  duration,
  comments,
  selectedId,
  onSeek,
  onSelectComment,
}: {
  currentTime: number;
  duration: number;
  comments: ReviewComment[];
  selectedId: number | null;
  onSeek: (t: number) => void;
  onSelectComment: (c: ReviewComment) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  const timedComments = comments.filter((c) => c.timestamp != null);

  const seekFromEvent = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = barRef.current;
      if (!bar || duration <= 0) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(ratio * duration);
    },
    [duration, onSeek],
  );

  return (
    <div
      ref={barRef}
      className="relative h-8 shrink-0 cursor-pointer select-none rounded-md border border-border bg-card/60 px-1"
      onClick={seekFromEvent}
      title="Cliquer pour se déplacer"
    >
      {/* Fond progress */}
      <div className="absolute inset-y-0 left-1 right-1 overflow-hidden rounded">
        <div className="h-full rounded bg-secondary/40" />
        <div
          className="absolute inset-y-0 left-0 rounded bg-primary/30 transition-none"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Curseur de lecture */}
      <div
        className="absolute top-0 bottom-0 w-0.5 rounded-full bg-primary z-10 pointer-events-none"
        style={{ left: `calc(${progress * 100}% * (100% - 8px) / 100% + 4px)` }}
      />

      {/* Marqueurs de commentaires */}
      {timedComments.map((c) => {
        const pos = (c.timestamp! / duration) * 100;
        const selected = c.id === selectedId;
        return (
          <button
            key={c.id}
            className={`absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-all
              ${selected ? 'h-4 w-4 border-primary bg-primary shadow-[0_0_0_2px_rgba(var(--primary)/0.3)]' : 'h-3 w-3 border-primary/60 bg-primary/40 hover:h-4 hover:w-4 hover:border-primary hover:bg-primary/80'}`}
            style={{ left: `calc(${pos}% * (100% - 8px) / 100% + 4px)` }}
            title={`${c.author?.name ?? 'Inconnu'} : ${c.content.slice(0, 60)}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectComment(c);
            }}
          />
        );
      })}

      {/* Timecode affiché à droite */}
      <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground pointer-events-none">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );
}
