import { useState, type ReactNode, type RefObject } from 'react';
import type { ReviewComment } from '../../types/api';
import { stepVideoFrame, tcFromFrame, VIEWER_ZONE } from './reviewTypes';
import { useReviewShortcuts } from './useReviewShortcuts';
import VideoTimeline from './VideoTimeline';

/**
 * Pane vidéo de la review : lecteur + overlay d'annotation, timeline à marqueurs
 * de commentaires, barre de métriques (frame, timecode, pas de frame, fps) et
 * raccourcis clavier (espace, ←/→, J/K/L, M — voir useReviewShortcuts).
 */
export default function VideoPane({
  src,
  videoRef,
  programmaticSeekRef,
  overlay,
  comments,
  selectedId,
  onSelectComment,
  onManualSeek,
  onMarker,
  fps,
  fpsDetected,
  setFpsOverride,
  startFrame,
}: {
  src: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Drapeau partagé : distingue un seek programmatique d'un déplacement manuel (qui désélectionne). */
  programmaticSeekRef: { current: boolean };
  overlay: ReactNode;
  comments: ReviewComment[];
  selectedId: number | null;
  onSelectComment: (c: ReviewComment) => void;
  onManualSeek: () => void;
  onMarker: () => void;
  fps: number;
  fpsDetected: boolean;
  setFpsOverride: (fps: number) => void;
  startFrame: number;
}) {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [duration, setDuration] = useState(0);

  useReviewShortcuts({ videoRef, fps, onMarker });

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (v) {
      programmaticSeekRef.current = true;
      v.currentTime = t;
    }
  };

  // Déplacement manuel dans la vidéo → on cache l'annotation et on désélectionne.
  const onSeeking = () => {
    if (programmaticSeekRef.current) {
      programmaticSeekRef.current = false;
      return;
    }
    onManualSeek();
  };

  return (
    <>
      <div className={VIEWER_ZONE}>
        <div className="relative inline-block max-h-full">
          <video
            ref={videoRef}
            src={src}
            controls
            className="block max-h-[calc(100vh-16rem)] max-w-full"
            onTimeUpdate={(e) => setCurrentFrame(Math.round(e.currentTarget.currentTime * fps))}
            onLoadedMetadata={(e) => {
              setCurrentFrame(Math.round(e.currentTarget.currentTime * fps));
              setDuration(e.currentTarget.duration);
            }}
            onSeeking={onSeeking}
          />
          {overlay}
        </div>
      </div>

      {/* Timeline avec marqueurs de commentaires */}
      {duration > 0 && (
        <VideoTimeline
          currentTime={currentFrame / fps}
          duration={duration}
          comments={comments}
          selectedId={selectedId}
          onSeek={seekTo}
          onSelectComment={onSelectComment}
        />
      )}

      {/* Barre de métriques : frame + timecode affichés en permanence */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
        <span className="font-mono text-sm">
          Frame <span className="text-primary">{startFrame + currentFrame}</span>
        </span>
        <span className="text-muted-foreground">TC {tcFromFrame(currentFrame, fps)}</span>
        <span className="text-muted-foreground">|</span>
        <button
          onClick={() => stepVideoFrame(videoRef.current, fps, -1)}
          title="Frame précédente (←)"
          className="rounded border border-border px-2 py-0.5 hover:bg-secondary/60"
        >
          ◀ -1
        </button>
        <button
          onClick={() => stepVideoFrame(videoRef.current, fps, 1)}
          title="Frame suivante (→)"
          className="rounded border border-border px-2 py-0.5 hover:bg-secondary/60"
        >
          +1 ▶
        </button>
        <span className="text-muted-foreground">|</span>
        <label className="flex items-center gap-1 text-muted-foreground">
          fps
          <input
            type="number"
            value={fps}
            min={1}
            max={120}
            disabled={fpsDetected}
            onChange={(e) => setFpsOverride(Number(e.target.value) || 24)}
            className="w-14 rounded border border-input bg-background px-1 py-0.5 disabled:opacity-60"
          />
          {fpsDetected && <span className="text-[10px]">(détecté)</span>}
        </label>
      </div>
    </>
  );
}
