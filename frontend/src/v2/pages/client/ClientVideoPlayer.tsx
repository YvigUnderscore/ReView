// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import type { ReviewComment } from '../../types/api';
import {
  cancelPendingPlay,
  createSeekCoalescer,
  safePlay,
  stepVideoFrame,
  viewerZone,
} from '../review/reviewTypes';
import { useReviewShortcuts } from '../review/useReviewShortcuts';
import { useVideoFullscreen } from '../review/useVideoFullscreen';
import { shouldLoopBack, useLoopPoints, usePlaybackSpeed, useVideoBuffering } from '../review/videoPaneHooks';
import VideoTimeline from '../review/VideoTimeline';
import VideoTransport from '../review/VideoTransport';
import { useT } from '../../i18n';

/**
 * Video player of the client share: the **same** transport as the internal review
 * (`VideoTransport`, `VideoTimeline`, `useReviewShortcuts`, `videoPaneHooks`) rather than a
 * bare `<video controls>` tag. The guest steps frame by frame, sets an I/O loop, plays
 * backwards (J/K/L) and clicks comments on the timeline.
 *
 * What is removed is whatever presumes an account: shared markers (authenticated write),
 * HLS quality (the master is served by an authenticated route), annotation and A/B
 * comparison. `VideoPane` itself is not reusable as-is, since it calls `useTimelineMarkers`
 * and `useHlsPlayer` internally; the exact gap is recorded in the batch report.
 */
export default function ClientVideoPlayer({
  src,
  videoRef,
  comments,
  selectedId,
  onSelectComment,
  onMarker,
  fps,
  fpsDetected,
  setFpsOverride,
  startFrame,
  watermark,
  overlay,
}: {
  src: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Comments expressed in **player time** (slate included), see `toPlayerComments`. */
  comments: ReviewComment[];
  selectedId: number | null;
  onSelectComment: (c: ReviewComment) => void;
  /** `M`: pauses and hands focus to the comment field. */
  onMarker: () => void;
  fps: number;
  /** Known frame rate of the media, which the guest can otherwise correct in the transport. */
  fpsDetected: boolean;
  setFpsOverride: (fps: number) => void;
  startFrame: number;
  watermark: ReactNode;
  /**
   * Annotation overlay, rendered INSIDE the image box rather than over the whole area: this
   * is the only position where normalized 0..1 coordinates land on the intended pixel,
   * whatever the black bars. It is pointer-neutral until drawing is armed, otherwise it
   * would swallow the click that starts playback.
   */
  overlay?: ReactNode;
}) {
  const t = useT();
  const [currentFrame, setCurrentFrame] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loopAll, setLoopAll] = useState(false);
  const [aspect, setAspect] = useState<number | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const loop = useLoopPoints(videoRef);
  const buffering = useVideoBuffering(videoRef, src);
  const playbackSpeed = usePlaybackSpeed(videoRef, src, playing);
  const {
    active: videoOnlyFs,
    controlsVisible,
    poke: pokeControls,
    toggle: toggleFullscreen,
  } = useVideoFullscreen(paneRef);

  useReviewShortcuts({
    videoRef,
    fps,
    onMarker,
    onLoopIn: loop.markIn,
    onLoopOut: loop.markOut,
    onClearLoop: loop.clear,
    onShuttle: playbackSpeed.onShuttle,
  });

  // Display box: the video fills the available space without distortion.
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

  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.volume = volume;
      v.muted = muted;
    }
  }, [videoRef, volume, muted]);

  // Seek coalescer: scrubbing emits dozens of seeks per second and each aborts the previous
  // one, so the next position is applied only once the current one completes.
  const seekRef = useRef<ReturnType<typeof createSeekCoalescer> | null>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const coalescer = createSeekCoalescer(v);
    seekRef.current = coalescer;
    return () => {
      coalescer.dispose();
      seekRef.current = null;
    };
  }, [videoRef, src]);

  const seekTo = (time: number) => {
    if (seekRef.current) seekRef.current.seek(time);
    else if (videoRef.current) videoRef.current.currentTime = time;
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
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
      <div ref={containerRef} className={viewerZone(videoOnlyFs)}>
        <div
          className="relative"
          style={box ? { width: box.w, height: box.h } : { maxWidth: '100%', maxHeight: '100%' }}
        >
          <video
            ref={videoRef}
            src={src}
            // Without CORS mode, Chrome's ORB blocks the cross-origin presigned mp4 (MinIO)
            // served as a no-cors subresource. Observed during browser verification.
            crossOrigin="anonymous"
            loop={loopAll}
            controlsList="nodownload"
            className="block h-full w-full cursor-pointer"
            onClick={togglePlay}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              setCurrentFrame(Math.round(v.currentTime * fps));
              if (shouldLoopBack(loop.loopIn, loop.loopOut, loop.enabled, v.paused, v.currentTime))
                v.currentTime = loop.loopIn!;
            }}
            onLoadedMetadata={(e) => {
              setCurrentFrame(Math.round(e.currentTarget.currentTime * fps));
              setDuration(e.currentTarget.duration);
              if (e.currentTarget.videoWidth > 0)
                setAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight);
            }}
          />
          {overlay && <div className="pointer-events-none absolute inset-0 z-20">{overlay}</div>}
        </div>
        {playbackSpeed.visible && (
          <div className="pointer-events-none absolute right-3 top-3 z-30 rounded-md bg-black/60 px-2 py-1 font-mono text-xs text-white backdrop-blur">
            {playbackSpeed.speed < 0 ? '◀' : '▶'} ×{Math.abs(playbackSpeed.speed)}
          </div>
        )}
        {buffering && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-30 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur">
            <Loader2 size={13} className="animate-spin" />
            {t('common.loading')}
          </div>
        )}
        {watermark}
      </div>

      <div
        className={
          videoOnlyFs
            ? `absolute inset-x-0 bottom-0 z-40 flex flex-col gap-2 bg-black/60 p-3 backdrop-blur-sm transition-opacity duration-300 ${
                controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`
            : 'contents'
        }
      >
        {duration > 0 && (
          <VideoTimeline
            currentTime={currentFrame / fps}
            duration={duration}
            comments={comments}
            selectedId={selectedId}
            onSeek={seekTo}
            onSelectComment={onSelectComment}
            loop={{ in: loop.loopIn, out: loop.loopOut }}
            fps={fps}
            startFrame={startFrame}
          />
        )}
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
          onFullscreen={toggleFullscreen}
          onFullscreenVideo={toggleFullscreen}
          videoOnlyFs={videoOnlyFs}
          loopActive={loop.loopIn != null || loop.loopOut != null}
          loopEnabled={loop.enabled}
          onToggleLoopEnabled={loop.toggleEnabled}
          onClearLoop={loop.clear}
          loopAll={loopAll}
          onToggleLoopAll={() => setLoopAll((l) => !l)}
        />
      </div>
    </div>
  );
}
