import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { ReviewComment } from '../../types/api';
import { stepVideoFrame, VIEWER_ZONE } from './reviewTypes';
import { useReviewShortcuts } from './useReviewShortcuts';
import { useHlsPlayer } from './useHlsPlayer';
import VideoTimeline from './VideoTimeline';
import VideoTransport from './VideoTransport';

/**
 * Pane vidéo de la review (14.B) : lecteur **custom** (plus de `controls` natif) + overlay
 * d'annotation, timeline unique (scrub + marqueurs commentaires + boucle I/O + trim) et
 * barre de transport HUD. Raccourcis clavier via useReviewShortcuts (espace/JKL/←→/I-O/M).
 */
export default function VideoPane({
  src,
  videoRef,
  programmaticSeekRef,
  overlay,
  compareOverlay,
  comments,
  selectedId,
  onSelectComment,
  onManualSeek,
  onMarker,
  fps,
  fpsDetected,
  setFpsOverride,
  startFrame,
  trimRange,
  hlsUrl,
}: {
  src: string;
  /** Master HLS servi par le proxy auth (Phase 23) — prioritaire sur `src` (MP4) si MSE dispo. */
  hlsUrl?: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Drapeau partagé : distingue un seek programmatique d'un déplacement manuel (qui désélectionne). */
  programmaticSeekRef: { current: boolean };
  overlay: ReactNode;
  /** Overlay de comparaison A/B en mode wipe (couvre la zone vidéo, 14.C). */
  compareOverlay?: ReactNode;
  comments: ReviewComment[];
  selectedId: number | null;
  onSelectComment: (c: ReviewComment) => void;
  onManualSeek: () => void;
  onMarker: () => void;
  fps: number;
  fpsDetected: boolean;
  setFpsOverride: (fps: number) => void;
  startFrame: number;
  /** Fenêtre de trim (secondes) — zones hors coupe grisées sur la timeline (10.G-V10). */
  trimRange?: { start: number; end: number } | null;
}) {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loopIn, setLoopIn] = useState<number | null>(null);
  const [loopOut, setLoopOut] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hls = useHlsPlayer(videoRef, hlsUrl ?? null);

  const markLoopIn = useCallback(() => {
    const v = videoRef.current;
    if (v) setLoopIn(v.currentTime);
  }, [videoRef]);
  const markLoopOut = useCallback(() => {
    const v = videoRef.current;
    if (v) setLoopOut(v.currentTime);
  }, [videoRef]);
  const clearLoop = useCallback(() => {
    setLoopIn(null);
    setLoopOut(null);
  }, []);

  useReviewShortcuts({
    videoRef,
    fps,
    onMarker,
    onLoopIn: markLoopIn,
    onLoopOut: markLoopOut,
    onClearLoop: clearLoop,
  });

  // Applique volume/mute au lecteur.
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.volume = volume;
      v.muted = muted;
    }
  }, [videoRef, volume, muted]);

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (v) {
      programmaticSeekRef.current = true;
      v.currentTime = t;
    }
  };

  const onTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    setCurrentFrame(Math.round(v.currentTime * fps));
    // Boucle I/O : au-delà de O, on repart de I (14.B).
    if (loopIn != null && loopOut != null && loopOut > loopIn && v.currentTime >= loopOut) {
      programmaticSeekRef.current = true;
      v.currentTime = loopIn;
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

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.playbackRate = 1;
      void v.play();
    } else v.pause();
  };

  const fullscreen = () => void containerRef.current?.requestFullscreen?.();

  return (
    <>
      <div className={VIEWER_ZONE} ref={containerRef}>
        <div className="relative inline-block max-h-full">
          <video
            ref={videoRef}
            src={hls.active ? undefined : src}
            className="block max-h-[calc(100vh-16rem)] max-w-full cursor-pointer"
            onClick={togglePlay}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={(e) => {
              setCurrentFrame(Math.round(e.currentTarget.currentTime * fps));
              setDuration(e.currentTarget.duration);
            }}
            onSeeking={onSeeking}
          />
          {overlay}
        </div>
        {hls.active && hls.levels.length > 1 && (
          <select
            title="Qualité de lecture"
            className="absolute right-2 top-2 rounded-md border border-border bg-black/60 px-2 py-1 text-xs text-white"
            value={hls.mode}
            onChange={(e) => hls.setLevel(Number(e.target.value))}
          >
            <option value={-1}>Auto</option>
            {hls.levels.map((l, i) => (
              <option key={i} value={i}>
                {l.height}p
              </option>
            ))}
          </select>
        )}
        {compareOverlay}
      </div>

      {/* Timeline unique : scrub + marqueurs commentaires + boucle I/O + trim */}
      {duration > 0 && (
        <VideoTimeline
          currentTime={currentFrame / fps}
          duration={duration}
          comments={comments}
          selectedId={selectedId}
          onSeek={seekTo}
          onSelectComment={onSelectComment}
          trimRange={trimRange}
          loop={{ in: loopIn, out: loopOut }}
        />
      )}

      {/* Transport custom (remplace controls natif) */}
      <VideoTransport
        playing={playing}
        onPlayPause={togglePlay}
        onStep={(d) => stepVideoFrame(videoRef.current, fps, d)}
        startFrame={startFrame}
        currentFrame={currentFrame}
        duration={duration}
        fps={fps}
        fpsDetected={fpsDetected}
        setFpsOverride={setFpsOverride}
        volume={volume}
        muted={muted}
        onVolume={(val) => {
          setVolume(val);
          setMuted(val === 0);
        }}
        onToggleMute={() => setMuted((m) => !m)}
        onFullscreen={fullscreen}
        loopActive={loopIn != null || loopOut != null}
        onClearLoop={clearLoop}
      />
    </>
  );
}
