import { Aperture, Crosshair, Frame, Home, Pause, PictureInPicture2, Play, RotateCcw } from 'lucide-react';
import { HudGroup, HudIconButton } from '../hud/ViewerHud';
import HudNumber from '../hud/HudNumber';
import { focalToFov, fovToFocal } from './focal';
import type { CameraAnimState } from './useCameraAnim';

const RAD = Math.PI / 180;

/**
 * Barre caméra commune 3D/splat (Phase 17), visible pour **tous** les spectateurs : cadrage F/H,
 * focale et tilt en champs « drag-label » (`HudNumber`, plus de sliders), profondeur de champ
 * (splat uniquement), mode layout (PiP), transport de l'animation caméra (pause auto au moindre
 * input, bouton « Réactiver »). Réglages locaux — seul le gestionnaire persiste la présentation.
 */
export default function CameraBar({
  fov,
  onFov,
  roll,
  onRoll,
  onFrame,
  onHome,
  kf,
  dof,
  layout,
}: {
  fov: number;
  onFov: (v: number) => void;
  /** Tilt (roll) en radians — affiché/saisi en degrés. */
  roll: number;
  onRoll: (rad: number) => void;
  onFrame: () => void;
  onHome: () => void;
  kf: Pick<CameraAnimState, 'hasAnimation' | 'playing' | 'play' | 'pause' | 'autoPaused'>;
  /** Profondeur de champ Spark (splat uniquement). */
  dof?: {
    aperture: number;
    onAperture: (v: number) => void;
    focusPick: boolean;
    onToggleFocusPick: () => void;
  };
  /** Mode layout « in/out camera » (PiP) — viewer 3D (splat : lot F). */
  layout?: { active: boolean; onToggle: () => void };
}) {
  return (
    <HudGroup>
      <HudIconButton icon={Frame} hint="Cadrer la sélection ou l'objet (F)" onClick={onFrame} />
      <HudIconButton icon={Home} hint="Vue d'origine (H)" onClick={onHome} />
      <span className="h-4 w-px bg-border" />
      <HudNumber
        label="Focale"
        hint="Focale en millimètres (capteur 36 mm) — Phase 26"
        value={Math.round(fovToFocal(fov))}
        onChange={(mm) => onFov(focalToFov(Math.min(Math.max(mm, 7), 400)))}
        min={7}
        max={400}
        step={1}
        unit="mm"
      />
      <HudNumber
        label="Tilt"
        hint="Tilt (roll) : inclinaison de la caméra autour de l'axe de vue"
        value={Math.round(roll / RAD)}
        onChange={(deg) => onRoll(deg * RAD)}
        min={-180}
        max={180}
        step={1}
        unit="°"
      />
      {dof && (
        <>
          <HudNumber
            label={<Aperture size={13} />}
            hint="Profondeur de champ : ouverture (0 = net partout)"
            value={dof.aperture}
            onChange={dof.onAperture}
            min={0}
            max={0.1}
            step={0.002}
            pixelsPerStep={6}
          />
          <HudIconButton
            icon={Crosshair}
            hint="Mise au point au clic : cliquer un point du splat pour régler la distance focale"
            active={dof.focusPick}
            onClick={dof.onToggleFocusPick}
          />
        </>
      )}
      {layout && (
        <HudIconButton
          icon={PictureInPicture2}
          hint="Mode layout : sortir de la caméra (vue libre) et voir son point de vue dans une fenêtre flottante (PiP)"
          active={layout.active}
          onClick={layout.onToggle}
        />
      )}
      {kf.hasAnimation && (
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
