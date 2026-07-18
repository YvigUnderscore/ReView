import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ReviewComment } from '../../types/api';
import { cancelPendingPlay, safePlay, stepVideoFrame, VIEWER_ZONE } from './reviewTypes';
import { useReviewShortcuts } from './useReviewShortcuts';
import { useHlsPlayer } from './useHlsPlayer';
import type { TimelineSpriteMeta } from './timelineSprite';
import VideoTimeline from './VideoTimeline';
import VideoTransport from './VideoTransport';

/**
 * Buffering du lecteur : vrai quand la vidéo attend des données (seek/switch qualité),
 * avec un léger délai anti-scintillement — pilote le spinner discret sur le viewer.
 */
function useVideoBuffering(videoRef: RefObject<HTMLVideoElement | null>, src: string) {
  const [buffering, setBuffering] = useState(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let timer: number | undefined;
    const start = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setBuffering(true), 180);
    };
    const stop = () => {
      window.clearTimeout(timer);
      setBuffering(false);
    };
    const startEvents = ['waiting', 'seeking', 'stalled'] as const;
    const stopEvents = ['playing', 'canplay', 'seeked'] as const;
    startEvents.forEach((e) => v.addEventListener(e, start));
    stopEvents.forEach((e) => v.addEventListener(e, stop));
    return () => {
      window.clearTimeout(timer);
      startEvents.forEach((e) => v.removeEventListener(e, start));
      stopEvents.forEach((e) => v.removeEventListener(e, stop));
    };
  }, [videoRef, src]);
  return buffering;
}

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
  timelineSprite,
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
  /** Sprite de miniatures de la timeline (filmstrip ~1 vignette / 3 s). */
  timelineSprite?: { url: string; meta: TimelineSpriteMeta } | null;
}) {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loopIn, setLoopIn] = useState<number | null>(null);
  const [loopOut, setLoopOut] = useState<number | null>(null);
  // Lecture en boucle de toute la vidéo (indépendante de la boucle I/O).
  const [loopAll, setLoopAll] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hls = useHlsPlayer(videoRef, hlsUrl ?? null);
  const buffering = useVideoBuffering(videoRef, src);

  // Feedback au changement de qualité : toast + spinner (hls.switching) le temps du switch.
  const changeQuality = (idx: number) => {
    hls.setLevel(idx);
    toast.success(`Qualité de lecture : ${hls.levels[idx]?.height ?? '?'}p`);
  };
  // Boîte d'affichage : la vidéo remplit tout l'espace disponible (fit « contain » calculé),
  // même en basse résolution — l'overlay d'annotation partage exactement la même boîte.
  const [aspect, setAspect] = useState<number | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !aspect) return;
    const fit = () => {
      const h = Math.min(el.clientHeight, el.clientWidth / aspect);
      setBox({ w: h * aspect, h });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

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
    // safePlay : ne démarre que quand l'image est décodable (pas de son sur image figée).
    if (v.paused) safePlay(v);
    else {
      cancelPendingPlay(v);
      v.pause();
    }
  };

  const fullscreen = () => void containerRef.current?.requestFullscreen?.();

  return (
    <>
      <div className={VIEWER_ZONE} ref={containerRef}>
        <div
          className="relative"
          style={box ? { width: box.w, height: box.h } : { maxWidth: '100%', maxHeight: '100%' }}
        >
          <video
            ref={videoRef}
            src={hls.active ? undefined : src}
            // anonymous : autorise la capture canvas de la frame courante (menu clic droit,
            // miniature) — MinIO/nginx renvoient les en-têtes CORS nécessaires.
            crossOrigin="anonymous"
            loop={loopAll}
            className="block h-full w-full cursor-pointer"
            onClick={togglePlay}
            onPlay={() => {
              setPlaying(true);
              // Le timecode avance : l'annotation du commentaire sélectionné n'est plus
              // alignée → on la masque (même logique que le seek manuel).
              onManualSeek();
            }}
            onPause={() => setPlaying(false)}
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={(e) => {
              setCurrentFrame(Math.round(e.currentTarget.currentTime * fps));
              setDuration(e.currentTarget.duration);
              if (e.currentTarget.videoWidth > 0)
                setAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight);
            }}
            onSeeking={onSeeking}
          />
          {overlay}
        </div>
        {/* Spinner discret : buffering (seek/scrub) ou changement de qualité en cours. */}
        {(buffering || hls.switching) && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-30 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur">
            <Loader2 size={13} className="animate-spin" />
            {hls.switching ? 'Changement de qualité…' : 'Chargement…'}
          </div>
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
          sprite={timelineSprite}
          onScrubStart={hls.beginScrub}
          onScrubEnd={hls.endScrub}
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
        loopAll={loopAll}
        onToggleLoopAll={() => setLoopAll((l) => !l)}
        quality={{
          active: hls.active,
          levels: hls.levels,
          mode: hls.mode,
          setLevel: changeQuality,
          switching: hls.switching,
        }}
      />
    </>
  );
}
