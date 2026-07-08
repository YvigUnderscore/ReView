import { HudGroup } from './ViewerHud';

/**
 * Réglages live du viewer splat (10.G-V1, togglable) : culling. Réglages locaux à la session
 * (non persistés) ; le panneau s'enrichira au fil des chantiers (DoF V5, debug color V6, LOD V7).
 */
export default function ViewerSettingsPanel({
  cullingOff,
  onCullingOff,
}: {
  cullingOff: boolean;
  onCullingOff: (off: boolean) => void;
}) {
  return (
    <HudGroup>
      <label
        className="flex cursor-pointer items-center gap-2"
        title="Par défaut Spark rogne les splats en bord de cadre (centres à 40 % hors cadre, rayon écran 512 px) — neutralisé, rien ne disparaît en zoom fort ; désactiver pour retrouver les défauts Spark (plus rapide sur les très gros nuages)."
      >
        <input
          type="checkbox"
          checked={cullingOff}
          onChange={(e) => onCullingOff(e.target.checked)}
          className="accent-primary"
        />
        <span className="text-foreground">Culling neutralisé</span>
      </label>
    </HudGroup>
  );
}
