// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { toast } from 'sonner';
import type { ReviewComment } from '../../types/api';
import { cancelPendingPlay, createSeekCoalescer, safePlay, stepVideoFrame, viewerZone } from './reviewTypes';
import { useReviewShortcuts } from './useReviewShortcuts';
import { useVideoFrameClock } from './useVideoFrameClock';
import { useHlsPlayer } from './useHlsPlayer';
import { useTimelineMarkers } from './useTimelineMarkers';
import { useVideoFullscreen } from './useVideoFullscreen';
import { shouldLoopBack, useLoopPoints, usePlaybackSpeed, useVideoBuffering } from './videoPaneHooks';
import type { TimelineSpriteMeta } from './timelineSprite';
import { RangeAnnotationsOverlay } from './RangeAnnotations';
import ZoomedGuidesLayer from './guides/ZoomedGuidesLayer';
import VideoTimeline from './VideoTimeline';
import VideoTransport from './VideoTransport';
import ViewerBadges from './ViewerBadges';
import WaveformStrip from './audio/WaveformStrip';
import { useVolumeControl } from './audio/useVolumeControl';
import { useWaveform } from './audio/useWaveform';
import LivePointers from './live/LivePointers';
import { useLivePointerCapture } from './live/useLivePointerCapture';
import { useFitBox } from './zoom/useFitBox';
import { useViewportZoom } from './zoom/useViewportZoom';
import { usePlaylistChain } from '../playlist/usePlaylistChain';
import { useT } from '../../i18n';

/**
 * Video pane of the review (14.B): **custom** player (no more native `controls`) + annotation
 * overlay, single timeline (scrub + comment markers + I/O loop + trim) and HUD transport bar.
 * Keyboard shortcuts via useReviewShortcuts (space/JKL/←→/I-O/M).
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
  /** Displayed media — shared timeline markers (34.C). */
  mediaId: number;
  /** HLS master served by the auth proxy (Phase 23) — takes priority over `src` (MP4) when MSE is available. */
  hlsUrl?: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Shared flag: distinguishes a programmatic seek from a manual move (which deselects). */
  programmaticSeekRef: { current: boolean };
  overlay: ReactNode;
  /** A/B comparison overlay in wipe mode (covers the video area, 14.C). */
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
  /** Trim window (seconds) — areas outside the cut are grayed out on the timeline (10.G-V10). */
  trimRange?: { start: number; end: number } | null;
  /** Timeline thumbnail sprite (filmstrip, ~1 thumbnail / 3 s). */
  timelineSprite?: { url: string; meta: TimelineSpriteMeta } | null;
  /** Toggles fullscreen for the whole review block (playbar included). */
  onFullscreen: () => void;
  /** I/O loop lifted to the parent (34.A): attached as an in→out range to the next comment. */
  onLoopChange?: (loop: { in: number | null; out: number | null }) => void;
}) {
  const t = useT();
  // Frame counter driven frame by frame (`requestVideoFrameCallback`, rAF fallback):
  // `timeupdate` alone only fires four times per second, and the displayed number lagged
  // by a quarter second during playback. The event stays wired in the hook as a safety net.
  const currentFrame = useVideoFrameClock(videoRef, fps);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audio = useVolumeControl(videoRef);
  // I/O loop can be disabled without losing the points (feedback 34) — toggle in the transport.
  const loop = useLoopPoints(videoRef);
  // Loops the whole video playback (independent of the I/O loop).
  const [loopAll, setLoopAll] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hls = useHlsPlayer(videoRef, hlsUrl ?? null, mediaId);
  const buffering = useVideoBuffering(videoRef, src);
  // Shared timeline markers (34.C) — placed by right-click on the timeline.
  const markersApi = useTimelineMarkers(mediaId);
  // Displayed playback speed (34.C): reverse shuttle (J) takes priority over playbackRate.
  const playbackSpeed = usePlaybackSpeed(videoRef, src, playing);

  // Feedback on quality change: toast + spinner (hls.switching) for the duration of the switch.
  const changeQuality = (idx: number) => {
    hls.setLevel(idx);
    toast.success(t('video.qualitySet', { height: hls.levels[idx]?.height ?? '?' }));
  };
  // Immersive video fullscreen (dedicated hook): fullscreen video + translucent playbar that
  // fades after 1 s without mouse movement. Complements the unified fullscreen.
  const paneRef = useRef<HTMLDivElement>(null);
  const {
    active: videoOnlyFs,
    controlsVisible,
    poke: pokeControls,
    toggle: toggleVideoFullscreen,
  } = useVideoFullscreen(paneRef);
  // Display box (computed "contain" fit): the annotation overlay, the shared cursors and the
  // A/B comparison all share exactly the same one. Re-measured on entering and exiting
  // fullscreen, otherwise the video would keep its previous size.
  //
  // In comparison, the box aligns to the area common to the panes (`CompareFitProvider`) —
  // except in fullscreen of a single pane: the B panes, left at their layout size behind the
  // image, would shrink the video instead of letting it cover the screen.
  const { box, setAspect } = useFitBox(containerRef, videoOnlyFs, !videoOnlyFs);
  const boxRef = useRef<HTMLDivElement>(null);
  // Player zoom/pan (wheel, drag, `+`/`-`/`0`/`1`): the image viewer always did this, not the
  // video. The comparison follows the same transform.
  const zoom = useViewportZoom({
    containerRef,
    oneToOneScale: () => (box && videoRef.current ? videoRef.current.videoWidth / box.w : null),
  });
  // Shared cursor of the live room: captured here, as a fraction of the frame.
  const livePointer = useLivePointerCapture(boxRef);
  // Audio waveform (computed at transcoding) and playlist chaining: two settings housed in the
  // timeline's right-click menu, not in extra buttons.
  const waveform = useWaveform(mediaId);
  const chain = usePlaylistChain(mediaId, videoRef);

  // Loop lifted to the orchestrator: in→out range of the next comment (34.A).
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

  // Seek coalescer: scrubbing emits dozens of seeks/s; without coalescing each
  // `currentTime =` aborts the previous one and hls.js ends up in an inconsistent state after
  // release (a single click = a single seek does not bug). We only apply the next position
  // once the current seek finishes, keeping only the last one requested.
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
    // I/O loop: past O, we restart from I — during playback only; manual navigation
    // freely goes past the O point (feedback 34).
    if (shouldLoopBack(loop.loopIn, loop.loopOut, loop.enabled, v.paused, v.currentTime)) {
      programmaticSeekRef.current = true;
      v.currentTime = loop.loopIn!;
    }
  };

  // Manual move in the video → we hide the annotation and deselect.
  const onSeeking = () => {
    if (programmaticSeekRef.current) {
      programmaticSeekRef.current = false;
      return;
    }
    onManualSeek();
  };

  const togglePlay = () => {
    const v = videoRef.current;
    // The click that ends a view move is not a playback command.
    if (!v || zoom.consumeClick()) return;
    // safePlay: only starts once the frame is decodable (no sound over a frozen frame).
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
        className={viewerZone(videoOnlyFs)}
        ref={containerRef}
        onPointerDown={zoom.handlers.onPointerDown}
        onPointerMove={(e) => {
          zoom.handlers.onPointerMove(e);
          livePointer.onPointerMove(e);
        }}
        onPointerUp={zoom.handlers.onPointerUp}
        onPointerLeave={livePointer.onPointerLeave}
      >
        <div
          ref={boxRef}
          className="relative"
          style={{
            ...(box ? { width: box.w, height: box.h } : { maxWidth: '100%', maxHeight: '100%' }),
            ...zoom.style,
          }}
        >
          <video
            ref={videoRef}
            src={hls.active ? undefined : src}
            // anonymous: allows canvas capture of the current frame (right-click menu,
            // thumbnail) — MinIO/nginx return the required CORS headers.
            crossOrigin="anonymous"
            loop={loopAll}
            className="block h-full w-full cursor-pointer"
            onClick={togglePlay}
            onPlay={() => {
              setPlaying(true);
              // The timecode advances: the selected comment's annotation is no longer
              // aligned → we hide it (same logic as a manual seek).
              onManualSeek();
            }}
            onPause={() => setPlaying(false)}
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration);
              if (e.currentTarget.videoWidth > 0)
                setAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight);
            }}
            onSeeking={onSeeking}
          />
          {/* Annotations over an in→out range (34.A): visible for the whole range. */}
          <RangeAnnotationsOverlay comments={comments} currentFrame={currentFrame} selectedId={selectedId} />
          {/* Other participants' cursors in the live room: inside the transformed layer,
              so they stay accurate under zoom as well as fit. */}
          <LivePointers />
          {overlay}
        </div>
        {/* The A/B comparison (wipe, difference) undergoes the same transform as the main
            layer: both images are centered in the same area, so they stay superimposed to the
            pixel once zoomed. */}
        {compareOverlay && (
          <div className="absolute inset-0" style={zoom.style}>
            {compareOverlay}
          </div>
        )}
        {/* After the comparison, otherwise it would cover them: the media layer is a stacking
            context as soon as it is zoomed (34.G). */}
        <ZoomedGuidesLayer box={box} zoomStyle={zoom.style} />
        {/* Floating markers: zoom, playback speed, loading. */}
        <ViewerBadges
          zoom={zoom}
          playbackSpeed={playbackSpeed}
          buffering={buffering}
          switchingQuality={hls.switching}
        />
      </div>

      {/* Playbar: in immersive mode, a dark translucent strip overlaid, hidden after 1 s of
          inactivity; otherwise, normal flow elements (display:contents). */}
      <div
        className={
          videoOnlyFs
            ? `absolute inset-x-0 bottom-0 z-40 flex flex-col gap-2 bg-black/60 p-3 backdrop-blur-sm transition-opacity duration-300 ${
                controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`
            : 'contents'
        }
      >
        {/* Single timeline: scrub + comment markers + I/O loop + trim */}
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
            waveform={{ available: waveform.available, enabled: waveform.visible, onToggle: waveform.toggle }}
            autoAdvance={{ available: chain.active, enabled: chain.enabled, onToggle: chain.toggle }}
            fps={fps}
            startFrame={startFrame}
          />
        )}

        {/* Audio waveform under the timeline: where the dialogue starts, where it cuts, whether
            the sound sticks to the picture — invisible until now, since it was not computed. */}
        <WaveformStrip track={waveform} duration={duration} time={currentFrame / fps} onSeek={seekTo} />

        {/* Custom transport (replaces native controls) */}
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
          volume={audio.volume}
          muted={audio.muted}
          onVolume={audio.setVolume}
          onToggleMute={audio.toggleMute}
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
