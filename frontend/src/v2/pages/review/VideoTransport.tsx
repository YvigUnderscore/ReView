// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ChevronLeft,
  ChevronRight,
  Expand,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Repeat,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import './chrome/chrome.css';
import { tcFromFrame } from './reviewTypes';
import type { HlsLevel } from './useHlsPlayer';
import { useT } from '../../i18n';

/**
 * Custom transport bar of the video player (14.B) — replaces `<video controls>`.
 * Play/pause, ±1 frame, frame + timecode, I/O loop, fps, volume/mute, fullscreen.
 */
export default function VideoTransport({
  playing,
  onPlayPause,
  onStep,
  startFrame,
  currentFrame,
  duration,
  fps,
  fpsDetected,
  setFpsOverride,
  volume,
  muted,
  onVolume,
  onToggleMute,
  onFullscreen,
  onFullscreenVideo,
  videoOnlyFs,
  loopActive,
  loopEnabled,
  onToggleLoopEnabled,
  onClearLoop,
  loopAll,
  onToggleLoopAll,
  quality,
}: {
  playing: boolean;
  onPlayPause: () => void;
  onStep: (delta: number) => void;
  startFrame: number;
  currentFrame: number;
  /** Total duration (s) — to display the last frame. */
  duration: number;
  fps: number;
  fpsDetected: boolean;
  setFpsOverride: (fps: number) => void;
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  /** Unified fullscreen (viewer + playbar + comments area). */
  onFullscreen: () => void;
  /** Video-only fullscreen (image + playbar, without comments). */
  onFullscreenVideo: () => void;
  /** True when video-only fullscreen is active (collapse icon). */
  videoOnlyFs: boolean;
  loopActive: boolean;
  /** I/O loop enabled: loops during playback. Disabling keeps the points (feedback 34). */
  loopEnabled: boolean;
  onToggleLoopEnabled: () => void;
  onClearLoop: () => void;
  /** Loops the whole video playback (independent of the I/O loop). */
  loopAll: boolean;
  onToggleLoopAll: () => void;
  /** HLS playback quality (Phase 23) — `active` is false if the media has no renditions. */
  quality?: {
    active: boolean;
    levels: HlsLevel[];
    /** Index of the rendition served (locked, no ABR). */
    level: number;
    setLevel: (i: number) => void;
    /** Quality change in progress (spinner next to the selector). */
    switching?: boolean;
  };
}) {
  const t = useT();
  const btn =
    'flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground';
  return (
    // Chrome transport row: same styles as the spatial viewers.
    <div className="rv-transport">
      <button
        onClick={onPlayPause}
        title={playing ? t('video.pauseKey') : t('video.playKey')}
        className={btn}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="flex items-center gap-0.5">
        <button onClick={() => onStep(-1)} title={t('review.prevFrame')} className={btn}>
          <ChevronLeft size={16} />
        </button>
        <button onClick={() => onStep(1)} title={t('video.nextFrameKey')} className={btn}>
          <ChevronRight size={16} />
        </button>
      </div>
      <button
        onClick={onToggleLoopAll}
        title={loopAll ? t('video.loopOn') : t('video.loopAll')}
        className={
          loopAll
            ? 'flex h-7 w-7 items-center justify-center rounded bg-primary/15 text-primary hover:bg-primary/25'
            : btn
        }
      >
        <Repeat size={15} />
      </button>

      <span className="font-mono text-sm">
        <span className="text-primary">{startFrame + currentFrame}</span>
        <span className="text-muted-foreground"> / {startFrame + Math.round(duration * fps)}</span>
        <span className="ml-2 text-muted-foreground">TC {tcFromFrame(currentFrame, fps)}</span>
      </span>

      {loopActive && (
        <span className="flex h-7 items-center overflow-hidden rounded border border-border">
          <button
            onClick={onToggleLoopEnabled}
            title={loopEnabled ? t('video.loopIoOn') : t('video.loopIoOff')}
            className={`flex h-full items-center gap-1 px-2 ${
              loopEnabled
                ? 'bg-primary/15 text-primary hover:bg-primary/25'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            <Repeat size={13} /> {t('video.loopIo')}
          </button>
          <button
            onClick={onClearLoop}
            title={t('review.clearIO')}
            className="flex h-full items-center border-l border-border px-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X size={12} />
          </button>
        </span>
      )}

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
      </label>

      <div className="ml-auto flex items-center gap-2">
        {/* Playback quality (Phase 23): Auto + HLS steps; "Original" alone if the
            media has no renditions (transcoded before adaptive HLS). */}
        <label
          className="flex items-center gap-1 text-muted-foreground"
          title={quality?.active ? t('video.quality') : t('video.noHls')}
        >
          {quality?.switching ? (
            <Loader2 size={13} className="animate-spin text-primary" />
          ) : (
            <SlidersHorizontal size={13} />
          )}
          <select
            value={quality?.active ? quality.level : 0}
            disabled={!quality?.active}
            onChange={(e) => quality?.setLevel(Number(e.target.value))}
            className="rounded border border-input bg-background px-1 py-0.5 text-xs disabled:opacity-60 [&>option]:bg-background"
          >
            {quality?.active ? (
              quality.levels.map((l, i) => (
                <option key={i} value={i}>
                  {l.height}p
                </option>
              ))
            ) : (
              <option value={0}>{t('video.qualityOriginal')}</option>
            )}
          </select>
        </label>
        <button onClick={onToggleMute} title={muted ? t('video.unmute') : t('video.mute')} className={btn}>
          {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          title={t('video.volume')}
          className="h-1 w-20 accent-primary"
        />
        <button
          onClick={onFullscreenVideo}
          title={videoOnlyFs ? t('video.exitFullscreen') : t('video.fullscreen')}
          className={btn}
        >
          {videoOnlyFs ? <Minimize size={16} /> : <Expand size={16} />}
        </button>
        <button onClick={onFullscreen} title={t('review.fullscreen')} className={btn}>
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
}
