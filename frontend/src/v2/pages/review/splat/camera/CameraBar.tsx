import { Aperture, Crosshair, Pause, Play, RotateCcw } from 'lucide-react';
import { HudGroup, HudIconButton } from '../hud/ViewerHud';
import type { CameraKeyframesState } from './useCameraKeyframes';
import type { CameraRigState } from './useCameraRig';

/**
 * Barre caméra du HUD (10.G-V5), visible pour **tous** les spectateurs : focale (fov),
 * profondeur de champ (ouverture + mise au point au clic), lecture de l'animation persistée
 * (pause auto au moindre input, bouton « Réactiver »). Réglages locaux — seul le gestionnaire
 * persiste (via l'éditeur keyframe, cf. KeyframeTimeline).
 */
export default function CameraBar({ rig, kf }: { rig: CameraRigState; kf: CameraKeyframesState }) {
  return (
    <HudGroup>
      <label className="flex items-center gap-1.5 text-muted-foreground" title="Focale (champ de vision)">
        Focale
        <input
          type="range"
          min={20}
          max={120}
          value={rig.fov}
          onChange={(e) => rig.setFov(Number(e.target.value))}
          className="h-1 w-16 accent-primary"
        />
        <span className="w-6 font-mono text-foreground">{Math.round(rig.fov)}°</span>
      </label>

      <label
        className="flex items-center gap-1.5 text-muted-foreground"
        title="Profondeur de champ : ouverture (0 = net partout)"
      >
        <Aperture size={13} />
        <input
          type="range"
          min={0}
          max={0.1}
          step={0.002}
          value={rig.aperture}
          onChange={(e) => rig.setAperture(Number(e.target.value))}
          className="h-1 w-16 accent-primary"
        />
      </label>
      <HudIconButton
        icon={Crosshair}
        hint="Mise au point au clic : cliquer un point du splat pour régler la distance focale"
        active={rig.focusPick}
        onClick={rig.toggleFocusPick}
      />

      {kf.keyframes.length >= 2 && (
        <>
          <span className="h-4 w-px bg-border" />
          <HudIconButton
            icon={kf.playing ? Pause : Play}
            hint={kf.playing ? "Mettre l'animation caméra en pause" : "Lire l'animation caméra"}
            active={kf.playing}
            onClick={kf.playing ? kf.pause : kf.play}
          />
          {kf.autoPaused && (
            <button
              onClick={kf.play}
              title="L'animation s'est mise en pause quand vous avez repris la main — la relancer"
              className="flex items-center gap-1 rounded bg-primary px-2 py-1 font-medium text-primary-foreground"
            >
              <RotateCcw size={12} /> Réactiver
            </button>
          )}
        </>
      )}
    </HudGroup>
  );
}
