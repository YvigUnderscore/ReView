import { Pause, Play, RotateCcw } from 'lucide-react';
import { HudGroup, HudIconButton } from './hud/ViewerHud';
import { orbitPreset } from './splat/camera/cameraAnim';
import { useCameraKeyframes } from './splat/camera/useCameraKeyframes';
import KeyframeTimeline from './splat/camera/KeyframeTimeline';
import type { Model3DThreeState } from './three/useModel3DThree';

const deg = (rad: number) => Math.round((rad * 180) / Math.PI);

/**
 * Barre caméra du viewer 3D Three (mode layout, Phase 15/16) : focale (fov), tilt (roll), et
 * **timeline keyframes** (ajouter une pose, preset orbite, lecture/scrub, courbes) — réutilise
 * le lecteur `useCameraKeyframes` commun via l'interface `CameraController`. Session seule pour
 * l'instant (la persistance « présentation » 3D commune arrive avec le backend dédié).
 */
export default function Model3DCameraBar({ model3d }: { model3d: Model3DThreeState }) {
  const kf = useCameraKeyframes(model3d);
  const applyOrbitPreset = () => {
    const view = model3d.captureCamera();
    if (!view) return;
    kf.setAll(orbitPreset(view), true);
    kf.play();
  };

  return (
    <>
      <HudGroup>
        <label className="flex items-center gap-1.5 text-muted-foreground" title="Focale (champ de vision)">
          Focale
          <input
            type="range"
            min={20}
            max={120}
            value={Math.round(model3d.fov)}
            onChange={(e) => model3d.setFov(Number(e.target.value))}
            className="h-1 w-16 accent-primary"
          />
          <span className="w-6 font-mono text-foreground">{Math.round(model3d.fov)}°</span>
        </label>
        <label
          className="flex items-center gap-1.5 text-muted-foreground"
          title="Tilt (roll) : inclinaison de la caméra autour de l'axe de vue"
        >
          Tilt
          <input
            type="range"
            min={-180}
            max={180}
            value={deg(model3d.roll)}
            onChange={(e) => model3d.setRoll((Number(e.target.value) * Math.PI) / 180)}
            className="h-1 w-16 accent-primary"
          />
          <span className="w-8 font-mono text-foreground">{deg(model3d.roll)}°</span>
        </label>
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
      <KeyframeTimeline kf={kf} onOrbitPreset={applyOrbitPreset} />
    </>
  );
}
