import { Camera, Palette } from 'lucide-react';
import { HudGroup } from './hud/ViewerHud';
import type { Model3DVariantsState } from './three/useModel3DVariants';

const selectCls = 'rounded border border-border bg-background/60 px-1 py-0.5 text-[11px] text-foreground';

/**
 * Variantes de matériaux (`KHR_materials_variants`) et caméras embarquées du GLB dans le HUD
 * (Phase 40, 40.C). Rendu uniquement si le modèle en porte. La sélection de variante bascule les
 * matériaux ; le menu caméras est un menu d'action (aller au point de vue) qui revient au libellé.
 */
export default function Model3DVariantsBar({ v }: { v: Model3DVariantsState }) {
  if (v.variants.length === 0 && v.cameras.length === 0) return null;
  return (
    <HudGroup>
      {v.variants.length > 0 && (
        <label className="flex items-center gap-1.5 text-muted-foreground" title="Variante de matériaux">
          <Palette size={13} />
          <select
            value={v.current}
            onChange={(e) => v.selectVariant(Number(e.target.value))}
            className={selectCls}
          >
            <option value={-1}>Défaut</option>
            {v.variants.map((name, i) => (
              <option key={i} value={i}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      {v.cameras.length > 0 && (
        <label className="flex items-center gap-1.5 text-muted-foreground" title="Caméras embarquées">
          <Camera size={13} />
          <select
            value=""
            onChange={(e) => {
              if (e.target.value !== '') v.goToCamera(Number(e.target.value));
            }}
            className={selectCls}
          >
            <option value="" disabled>
              Vue caméra…
            </option>
            {v.cameras.map((c, i) => (
              <option key={i} value={i}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </HudGroup>
  );
}
