import { Film, Pause, Play } from 'lucide-react';
import { HudGroup, HudIconButton } from './hud/ViewerHud';
import type { Model3DThreeState } from './three/useModel3DThree';

/**
 * Lecture des animations du GLB dans le HUD flottant (Phase 17, extrait de l'ex-`Model3DToolbar`
 * dissous) : play/pause de l'animation courante + sélecteur de clip. Rendu uniquement si le
 * modèle porte au moins une animation.
 */
export default function Model3DAnimationsBar({ m }: { m: Model3DThreeState }) {
  if (m.animations.length === 0) return null;
  return (
    <HudGroup>
      <HudIconButton
        icon={m.playing ? Pause : Play}
        hint={m.playing ? "Mettre l'animation du modèle en pause" : "Lire l'animation du modèle"}
        active={m.playing}
        onClick={m.playing ? m.pauseAnim : m.playAnim}
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
