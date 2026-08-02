// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ReviewComment } from '../../types/api';
import { cancelPendingPlay, createSeekCoalescer, safePlay, stepVideoFrame, VIEWER_ZONE } from './reviewTypes';
import { useReviewShortcuts } from './useReviewShortcuts';
import { useHlsPlayer } from './useHlsPlayer';
import { useTimelineMarkers } from './useTimelineMarkers';
import { useVideoFullscreen } from './useVideoFullscreen';
import { shouldLoopBack, useLoopPoints, usePlaybackSpeed, useVideoBuffering } from './videoPaneHooks';
import type { TimelineSpriteMeta } from './timelineSprite';
import { RangeAnnotationsOverlay } from './RangeAnnotations';
import CompositionGuides from './CompositionGuides';
import VideoTimeline from './VideoTimeline';
import VideoTransport from './VideoTransport';
import { useT } from '../../i18n';

/**
 * Pane vidéo de la review (14.B) : lecteur **custom** (plus de `controls` natif) + overlay
 * d'annotation, timeline unique (scrub + marqueurs commentaires + boucle I/O + trim) et
 * barre de transport HUD. Raccourcis clavier via useReviewShortcuts (espace/JKL/←→/I-O/M).
 */
export default function VideoPane({
  src,
  mediaId,
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
  onFullscreen,
  onLoopChange,
}: {
  src: string;
  /** Média affiché — marqueurs de timeline partagés (34.C). */
  mediaId: number;
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
  /** Bascule le plein écran de tout le bloc review (playbar incluse). */
  onFullscreen: () => void;
  /** Boucle I/O remontée (34.A) : jointe comme plage in→out au prochain commentaire. */
  onLoopChange?: (loop: { in: number | null; out: number | null }) => void;
}) {
  const t = useT();
  const [currentFrame, setCurrentFrame] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  // Boucle I/O désactivable sans perdre les points (retours 34) — toggle dans le transport.
  const loop = useLoopPoints(videoRef);
  // Lecture en boucle de toute la vidéo (indépendante de la boucle I/O).
  const [loopAll, setLoopAll] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hls = useHlsPlayer(videoRef, hlsUrl ?? null, mediaId);
  const buffering = useVideoBuffering(videoRef, src);
  // Marqueurs de timeline partagés (34.C) — posés par clic droit sur la timeline.
  const markersApi = useTimelineMarkers(mediaId);
  // Vitesse de lecture affichée (34.C) : shuttle arrière (J) prioritaire sur playbackRate.
  const playbackSpeed = usePlaybackSpeed(videoRef, src, playing);

  // Feedback au changement de qualité : toast + spinner (hls.switching) le temps du switch.
  const changeQuality = (idx: number) => {
    hls.setLevel(idx);
    toast.success(`Qualité de lecture : ${hls.levels[idx]?.height ?? '?'}p`);
  };
  // Boîte d'affichage : la vidéo remplit tout l'espace disponible (fit « contain » calculé),
  // même en basse résolution — l'overlay d'annotation partage exactement la même boîte.
  const [aspect, setAspect] = useState<number | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // Plein écran vidéo immersif (hook dédié) : vidéo plein écran + playbar translucide qui
  // s'efface après 1 s sans mouvement de souris. Complémentaire du plein écran unifié.
  const paneRef = useRef<HTMLDivElement>(null);
  const {
    active: videoOnlyFs,
    controlsVisible,
    poke: pokeControls,
    toggle: toggleVideoFullscreen,
  } = useVideoFullscreen(paneRef);
  // `videoOnlyFs` en dépendance : l'entrée/sortie du plein écran change la taille du
  // conteneur → on re-mesure la boîte (sinon la vidéo garderait sa taille d'avant, minuscule
  // au centre de l'écran noir).
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
  }, [aspect, videoOnlyFs]);

  // Boucle remontée à l'orchestrateur : plage in→out du prochain commentaire (34.A).
  useEffect(() => {
    onLoopChange?.({ in: loop.loopIn, out: loop.loopOut });
  }, [loop.loopIn, loop.loopOut, onLoopChange]);

  useReviewShortcuts({
    videoRef,
    fps,
    onMarker,
    onLoopIn: loop.markIn,
    onLoopOut: loop.markOut,
    onClearLoop: loop.clear,
    onShuttle: playbackSpeed.onShuttle,
  });

  // Applique volume/mute au lecteur.
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.volume = volume;
      v.muted = muted;
    }
  }, [videoRef, volume, muted]);

  // Coalesceur de seeks : le scrub émet des dizaines de seeks/s ; sans coalescing chaque
  // `currentTime =` avorte le précédent et hls.js finit dans un état incohérent après le
  // lâcher (un clic simple = un seul seek ne bugue pas). On n'applique la position suivante
  // qu'une fois le seek courant terminé, en ne gardant que la dernière demandée.
  const seekCoalescerRef = useRef<ReturnType<typeof createSeekCoalescer> | null>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const c = createSeekCoalescer(v, () => {
      programmaticSeekRef.current = true;
    });
    seekCoalescerRef.current = c;
    return () => {
      c.dispose();
      seekCoalescerRef.current = null;
    };
  }, [videoRef, programmaticSeekRef, src]);

  const seekTo = (t: number) => {
    if (seekCoalescerRef.current) seekCoalescerRef.current.seek(t);
    else if (videoRef.current) {
      programmaticSeekRef.current = true;
      videoRef.current.currentTime = t;
    }
  };

  const onTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    setCurrentFrame(Math.round(v.currentTime * fps));
    // Boucle I/O : au-delà de O, on repart de I — en lecture seulement, la navigation
    // manuelle dépasse librement le point O (retours 34).
    if (shouldLoopBack(loop.loopIn, loop.loopOut, loop.enabled, v.paused, v.currentTime)) {
      programmaticSeekRef.current = true;
      v.currentTime = loop.loopIn!;
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

  return (
    <div
      ref={paneRef}
      onPointerMove={videoOnlyFs ? pokeControls : undefined}
      className={
        videoOnlyFs
          ? `relative h-full w-full bg-black ${controlsVisible ? '' : 'cursor-none'}`
          : 'flex min-h-0 flex-1 flex-col gap-2'
      }
    >
      <div
        className={`${VIEWER_ZONE} ${videoOnlyFs ? 'absolute inset-0 rounded-none border-0 bg-black' : ''}`}
        ref={containerRef}
      >
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
          {/* Annotations sur plage in→out (34.A) : visibles pendant toute la plage. */}
          <RangeAnnotationsOverlay comments={comments} currentFrame={currentFrame} selectedId={selectedId} />
          {/* Guides de composition (34.G) : tiers / croix / safe areas, via clic droit. */}
          <CompositionGuides />
          {overlay}
        </div>
        {/* Vitesse de lecture (34.C) : visible dès qu'on n'est pas en lecture normale ×1. */}
        {playbackSpeed.visible && (
          <div className="pointer-events-none absolute right-3 top-3 z-30 rounded-md bg-black/60 px-2 py-1 font-mono text-xs text-white backdrop-blur">
            {playbackSpeed.speed < 0 ? '◀' : '▶'} ×{Math.abs(playbackSpeed.speed)}
          </div>
        )}
        {/* Spinner discret : buffering (seek/scrub) ou changement de qualité en cours. */}
        {(buffering || hls.switching) && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-30 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur">
            <Loader2 size={13} className="animate-spin" />
            {hls.switching ? 'Changement de qualité…' : t('common.loading')}
          </div>
        )}
        {compareOverlay}
      </div>

      {/* Playbar : en mode immersif, bandeau translucide sombre en surimpression, masqué
          après 1 s d'inactivité ; sinon, éléments normaux du flux (display:contents). */}
      <div
        className={
          videoOnlyFs
            ? `absolute inset-x-0 bottom-0 z-40 flex flex-col gap-2 bg-black/60 p-3 backdrop-blur-sm transition-opacity duration-300 ${
                controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`
            : 'contents'
        }
      >
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
            loop={{ in: loop.loopIn, out: loop.loopOut }}
            sprite={timelineSprite}
            markersApi={markersApi}
            fps={fps}
            startFrame={startFrame}
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
          onFullscreen={onFullscreen}
          onFullscreenVideo={toggleVideoFullscreen}
          videoOnlyFs={videoOnlyFs}
          loopActive={loop.loopIn != null || loop.loopOut != null}
          loopEnabled={loop.enabled}
          onToggleLoopEnabled={loop.toggleEnabled}
          onClearLoop={loop.clear}
          loopAll={loopAll}
          onToggleLoopAll={() => setLoopAll((l) => !l)}
          quality={{
            active: hls.active,
            levels: hls.levels,
            level: hls.level,
            setLevel: changeQuality,
            switching: hls.switching,
          }}
        />
      </div>
    </div>
  );
}
