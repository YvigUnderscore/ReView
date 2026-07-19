import { RotateCw } from 'lucide-react';
import { HudGroup, HudIconButton } from './hud/ViewerHud';
import HudNumber from './hud/HudNumber';
import type { TurntableState } from './three/useTurntable';
import { TURNTABLE_SPEED_MAX, TURNTABLE_SPEED_MIN, type TurntableAxis } from './three/turntable';

/**
 * Barre du turntable (39.D) : rotation automatique de la vue (session-local). Bascule + choix de
 * l'axe et de la vitesse (n'apparaissent qu'une fois actif — HUD compact).
 */
export default function TurntableBar({ tt }: { tt: TurntableState }) {
  return (
    <HudGroup>
      <HudIconButton
        icon={RotateCw}
        hint="Turntable — rotation automatique de la vue"
        active={tt.active}
        onClick={tt.toggle}
      />
      {tt.active && (
        <>
          <select
            value={tt.axis}
            onChange={(e) => tt.setAxis(e.target.value as TurntableAxis)}
            title="Axe de rotation"
            className="rounded border border-border bg-background/60 px-1 py-0.5 text-[11px] text-foreground"
          >
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="z">Z</option>
          </select>
          <HudNumber
            label="°/s"
            hint="Vitesse (degrés/seconde)"
            value={Math.round(tt.speed)}
            onChange={tt.setSpeed}
            min={TURNTABLE_SPEED_MIN}
            max={TURNTABLE_SPEED_MAX}
            step={1}
          />
        </>
      )}
    </HudGroup>
  );
}
