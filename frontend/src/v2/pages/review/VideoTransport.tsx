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
  /** Durée totale (s) — pour afficher la frame de fin. */
  duration: number;
  fps: number;
  fpsDetected: boolean;
  setFpsOverride: (fps: number) => void;
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  /** Plein écran unifié (viewer + playbar + espace commentaires). */
  onFullscreen: () => void;
  /** Plein écran vidéo seule (image + playbar, sans commentaires). */
  onFullscreenVideo: () => void;
  /** Vrai quand le plein écran vidéo seule est actif (icône réduire). */
  videoOnlyFs: boolean;
  loopActive: boolean;
  /** Boucle I/O activée : rebouclage à la lecture. Désactiver conserve les points (retours 34). */
  loopEnabled: boolean;
  onToggleLoopEnabled: () => void;
  onClearLoop: () => void;
  /** Lecture en boucle de toute la vidéo (indépendante de la boucle I/O). */
  loopAll: boolean;
  onToggleLoopAll: () => void;
  /** Qualité de lecture HLS (Phase 23) — `active` faux si le média n'a pas de renditions. */
  quality?: {
    active: boolean;
    levels: HlsLevel[];
    /** Index de la rendition servie (verrouillée, pas d'ABR). */
    level: number;
    setLevel: (i: number) => void;
    /** Changement de qualité en cours (spinner à côté du sélecteur). */
    switching?: boolean;
  };
}) {
  const btn =
    'flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground';
  return (
    // Ligne de transport du chrome : mêmes styles que les viewers spatiaux.
    <div className="rv-transport">
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
        <span className="flex h-7 items-center overflow-hidden rounded border border-border">
          <button
            onClick={onToggleLoopEnabled}
            title={
              loopEnabled
                ? 'Boucle entre les points I/O active — cliquer pour la suspendre (les points restent posés)'
                : 'Boucle I/O suspendue — cliquer pour reboucler entre les points I/O'
            }
            className={`flex h-full items-center gap-1 px-2 ${
              loopEnabled
                ? 'bg-primary/15 text-primary hover:bg-primary/25'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            <Repeat size={13} /> Boucle I/O
          </button>
          <button
            onClick={onClearLoop}
            title="Effacer les points I/O (Maj+I / Maj+O)"
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
        {/* Qualité de lecture (Phase 23) : Auto + paliers HLS ; « Originale » seule si le
            média n'a pas de renditions (transcodé avant le HLS adaptatif). */}
        <label
          className="flex items-center gap-1 text-muted-foreground"
          title={
            quality?.active
              ? 'Qualité de lecture (défaut : la plus haute)'
              : 'Pas de renditions HLS pour ce média — lecture du proxy original'
          }
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
        <button
          onClick={onFullscreenVideo}
          title={videoOnlyFs ? 'Quitter le plein écran vidéo' : 'Plein écran vidéo seule (sans commentaires)'}
          className={btn}
        >
          {videoOnlyFs ? <Minimize size={16} /> : <Expand size={16} />}
        </button>
        <button onClick={onFullscreen} title="Plein écran avec l’espace review" className={btn}>
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
}
