import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize,
  Pause,
  Play,
  Repeat,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { HudGroup } from './hud/ViewerHud';
import { tcFromFrame } from './reviewTypes';
import type { HlsLevel } from './useHlsPlayer';

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
  loopAll,
  onToggleLoopAll,
  quality,
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
  /** Lecture en boucle de toute la vidéo (indépendante de la boucle I/O). */
  loopAll: boolean;
  onToggleLoopAll: () => void;
  /** Qualité de lecture HLS (Phase 23) — `active` faux si le média n'a pas de renditions. */
  quality?: {
    active: boolean;
    levels: HlsLevel[];
    mode: number;
    setLevel: (i: number) => void;
    /** Changement de qualité en cours (spinner à côté du sélecteur). */
    switching?: boolean;
  };
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
      <button
        onClick={onToggleLoopAll}
        title={loopAll ? 'Lecture en boucle activée — cliquer pour désactiver' : 'Lire en boucle'}
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
        <button
          onClick={onClearLoop}
          title="Boucle entre les points I/O — cliquer pour l'effacer (Maj+I/O)"
          className="flex h-7 items-center gap-1 rounded bg-primary/15 px-2 text-primary hover:bg-primary/25"
        >
          <Repeat size={13} /> Boucle I/O
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
        {/* Qualité de lecture (Phase 23) : Auto + paliers HLS ; « Originale » seule si le
            média n'a pas de renditions (transcodé avant le HLS adaptatif). */}
        <label
          className="flex items-center gap-1 text-muted-foreground"
          title={
            quality?.active
              ? 'Qualité de lecture (Auto = max soutenable)'
              : 'Pas de renditions HLS pour ce média — lecture du proxy original'
          }
        >
          {quality?.switching ? (
            <Loader2 size={13} className="animate-spin text-primary" />
          ) : (
            <SlidersHorizontal size={13} />
          )}
          <select
            value={quality?.active ? quality.mode : 0}
            disabled={!quality?.active}
            onChange={(e) => quality?.setLevel(Number(e.target.value))}
            className="rounded border border-input bg-background px-1 py-0.5 text-xs disabled:opacity-60 [&>option]:bg-background"
          >
            {quality?.active ? (
              <>
                <option value={-1}>Auto</option>
                {quality.levels.map((l, i) => (
                  <option key={i} value={i}>
                    {l.height}p
                  </option>
                ))}
              </>
            ) : (
              <option value={0}>Originale</option>
            )}
          </select>
        </label>
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
