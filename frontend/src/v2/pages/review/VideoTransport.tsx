import { ChevronLeft, ChevronRight, Maximize, Pause, Play, Repeat, Volume2, VolumeX } from 'lucide-react';
import { HudGroup } from './hud/ViewerHud';
import { tcFromFrame } from './reviewTypes';

/**
 * Barre de transport custom du lecteur vidéo (14.B) — remplace `<video controls>`.
 * Play/pause, ±1 frame, frame + timecode, boucle I/O, fps, volume/mute, plein écran.
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
  loopActive,
  onClearLoop,
}: {
  playing: boolean;
  onPlayPause: () => void;
  onStep: (delta: number) => void;
  startFrame: number;
  currentFrame: number;
  /** Durée totale (s) — pour afficher la frame de fin. */
  duration: number;
  fps: number;
  fpsDetected: boolean;
  setFpsOverride: (fps: number) => void;
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onFullscreen: () => void;
  loopActive: boolean;
  onClearLoop: () => void;
}) {
  const btn =
    'flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground';
  return (
    <HudGroup className="w-full justify-start gap-3">
      <button onClick={onPlayPause} title={playing ? 'Pause (espace)' : 'Lecture (espace)'} className={btn}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="flex items-center gap-0.5">
        <button onClick={() => onStep(-1)} title="Frame précédente (←)" className={btn}>
          <ChevronLeft size={16} />
        </button>
        <button onClick={() => onStep(1)} title="Frame suivante (→)" className={btn}>
          <ChevronRight size={16} />
        </button>
      </div>

      <span className="font-mono text-sm">
        <span className="text-primary">{startFrame + currentFrame}</span>
        <span className="text-muted-foreground"> / {startFrame + Math.round(duration * fps)}</span>
        <span className="ml-2 text-muted-foreground">TC {tcFromFrame(currentFrame, fps)}</span>
      </span>

      {loopActive && (
        <button
          onClick={onClearLoop}
          title="Boucle active — cliquer pour l'effacer (Maj+I/O)"
          className="flex h-7 items-center gap-1 rounded bg-primary/15 px-2 text-primary hover:bg-primary/25"
        >
          <Repeat size={13} /> Boucle
        </button>
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
        <button onClick={onToggleMute} title={muted ? 'Réactiver le son' : 'Couper le son'} className={btn}>
          {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          title="Volume"
          className="h-1 w-20 accent-primary"
        />
        <button onClick={onFullscreen} title="Plein écran" className={btn}>
          <Maximize size={16} />
        </button>
      </div>
    </HudGroup>
  );
}
