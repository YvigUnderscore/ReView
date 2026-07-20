import { Film, Gauge, Pause, Play, Repeat } from 'lucide-react';
import { HudGroup, HudIconButton } from './hud/ViewerHud';
import HudNumber from './hud/HudNumber';
import type { Model3DThreeState } from './three/useModel3DThree';

const fmt = (ms: number) => (ms / 1000).toFixed(2);

/**
 * Transport des animations du GLB dans le HUD flottant (Phase 17, transport complet en 40.A) :
 * play/pause, **scrub** (tête de lecture), temps/durée, **vitesse**, **boucle** et sélecteur de
 * clip. Rendu uniquement si le modèle porte au moins une animation.
 */
export default function Model3DAnimationsBar({ m }: { m: Model3DThreeState }) {
  if (m.animations.length === 0) return null;
  const dur = m.durationMs;
  return (
    <HudGroup>
      <HudIconButton
        icon={m.playing ? Pause : Play}
        hint={m.playing ? "Mettre l'animation du modèle en pause" : "Lire l'animation du modèle"}
        active={m.playing}
        onClick={m.playing ? m.pause : m.play}
      />
      <input
        type="range"
        min={0}
        max={Math.max(dur, 1)}
        step={1}
        value={Math.min(m.timeMs, dur)}
        onChange={(e) => m.scrub(Number(e.target.value))}
        title="Tête de lecture de l'animation — glisser pour naviguer image par image"
        className="h-1 w-28 cursor-pointer accent-primary"
        aria-label="Tête de lecture de l'animation"
      />
      <span className="min-w-16 font-mono text-[11px] text-muted-foreground">
        {fmt(Math.min(m.timeMs, dur))}/{fmt(dur)}s
      </span>
      <HudNumber
        label={<Gauge size={12} />}
        hint="Vitesse de lecture de l'animation (×)"
        value={m.speed}
        onChange={m.setSpeed}
        min={0.1}
        max={4}
        step={0.1}
        pixelsPerStep={8}
        unit="×"
      />
      <HudIconButton
        icon={Repeat}
        hint="Lire l'animation en boucle"
        active={m.loop}
        onClick={() => m.setLoop(!m.loop)}
      />
      {m.animations.length > 1 ? (
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <Film size={13} />
          <select
            value={m.currentAnim ?? ''}
            onChange={(e) => m.selectAnim(e.target.value)}
            className="rounded border border-border bg-background/60 px-1 py-0.5 text-[11px] text-foreground"
          >
            {m.animations.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="text-[11px] text-muted-foreground">{m.currentAnim}</span>
      )}
    </HudGroup>
  );
}
