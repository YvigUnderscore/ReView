// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { formatTimecode } from './timelinePlayback';
import { useT } from '../../i18n';

/**
 * Barre de transport du montage (Phase 46).
 *
 * Les repères sont ceux d'une review : image par image, timecode et NUMÉRO DE FRAME du
 * film. Un retour de montage se donne à la frame près, comme ailleurs — sauf qu'ici la
 * frame est celle du film entier, la seule échelle qu'une timeline unique puisse porter.
 */
export default function MontageTransport({
  playing,
  time,
  total,
  fps,
  muted,
  volume,
  fullscreen,
  onToggle,
  onStep,
  onVolume,
  onToggleMute,
  onFullscreen,
}: {
  playing: boolean;
  time: number;
  total: number;
  fps: number;
  muted: boolean;
  volume: number;
  fullscreen: boolean;
  onToggle: () => void;
  onStep: (delta: number) => void;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onFullscreen: () => void;
}) {
  const t = useT();
  const frame = Math.round(time * fps);
  const frames = Math.round(total * fps);

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
      <button
        onClick={onToggle}
        title={playing ? t('timeline.pause') : t('video.playKey')}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <button
        onClick={() => onStep(-1)}
        title={t('review.prevFrame')}
        className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground hover:bg-secondary/60"
      >
        <ChevronLeft size={14} />
      </button>
      <button
        onClick={() => onStep(1)}
        title={t('video.nextFrameKey')}
        className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground hover:bg-secondary/60"
      >
        <ChevronRight size={14} />
      </button>

      <span className="ml-2 font-mono text-xs tabular-nums">
        <span className="text-primary">{frame}</span>
        <span className="text-muted-foreground"> / {frames}</span>
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {formatTimecode(time)} / {formatTimecode(total)}
      </span>
      <span className="text-[11px] text-muted-foreground">{fps} fps</span>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onToggleMute}
          title={muted ? t('video.unmute') : t('video.mute')}
          className="text-muted-foreground hover:text-foreground"
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          title={t('video.volume')}
          className="h-1 w-24 accent-primary"
        />
        <button
          onClick={onFullscreen}
          title={fullscreen ? t('timeline.exitFullscreen') : t('timeline.fullscreen')}
          className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground hover:bg-secondary/60"
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  );
}
