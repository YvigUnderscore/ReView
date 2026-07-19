import { Scissors, FlipHorizontal2 } from 'lucide-react';
import { HudGroup, HudIconButton } from './hud/ViewerHud';
import HudNumber from './hud/HudNumber';
import type { SectionPlaneState } from './three/useSectionPlane';
import type { SectionAxis } from './three/sectionPlane';

/**
 * Barre du plan de coupe (39.D) : masque une moitié du modèle le long d'un axe. Bascule + axe,
 * position (glisser/saisir) et inversion du côté — visibles seulement quand la coupe est active.
 */
export default function SectionBar({ sec }: { sec: SectionPlaneState }) {
  const span = sec.bounds.max - sec.bounds.min || 1;
  return (
    <HudGroup>
      <HudIconButton
        icon={Scissors}
        hint="Plan de coupe (section du modèle)"
        active={sec.active}
        onClick={sec.toggle}
      />
      {sec.active && (
        <>
          <select
            value={sec.axis}
            onChange={(e) => sec.setAxis(e.target.value as SectionAxis)}
            title="Axe de coupe"
            className="rounded border border-border bg-background/60 px-1 py-0.5 text-[11px] text-foreground"
          >
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="z">Z</option>
          </select>
          <HudNumber
            label="Pos"
            hint="Position du plan (glisser ou saisir)"
            value={Number(sec.position.toFixed(3))}
            onChange={sec.setPosition}
            min={sec.bounds.min}
            max={sec.bounds.max}
            step={span / 200}
            pixelsPerStep={2}
          />
          <HudIconButton
            icon={FlipHorizontal2}
            hint="Inverser le côté conservé"
            active={sec.flip}
            onClick={sec.toggleFlip}
          />
        </>
      )}
    </HudGroup>
  );
}
