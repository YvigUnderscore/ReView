import { Bone, Info } from 'lucide-react';
import { HudGroup } from './hud/ViewerHud';
import { DISPLAY_MODES, type DisplayMode } from './three/displayModes';
import type { Model3DInspectState } from './three/useModel3DInspect';

/** Libellés courts des modes d'affichage (segmented control du HUD). */
const MODE_LABELS: Record<DisplayMode, string> = {
  shaded: 'Ombré',
  wireframe: 'Fil',
  normals: 'Normales',
  matcap: 'Matcap',
  uv: 'UV',
};

const MODE_HINTS: Record<DisplayMode, string> = {
  shaded: 'Rendu matériaux (défaut)',
  wireframe: 'Fil de fer (topologie)',
  normals: 'Normales (débogage orientation)',
  matcap: 'Matcap argile (juger la forme sans textures)',
  uv: 'Damier UV (étirement/orientation des UV)',
};

/**
 * Barre d'inspection du viewer 3D (Phase 39, 39.C) : bascule des **modes d'affichage**
 * (ombré/fil/normales/matcap/UV, override non destructif) + bouton d'ouverture de la fiche
 * technique. Local à la session (aucune persistance) — outil d'inspection, pas de mise en scène.
 */
export default function InspectBar({
  inspect,
  infoOpen,
  onToggleInfo,
}: {
  inspect: Model3DInspectState;
  infoOpen: boolean;
  onToggleInfo: () => void;
}) {
  return (
    <HudGroup>
      <span className="text-muted-foreground">Rendu</span>
      <div className="flex items-center overflow-hidden rounded border border-border">
        {DISPLAY_MODES.map((m) => (
          <button
            key={m}
            onClick={() => inspect.setMode(m)}
            title={MODE_HINTS[m]}
            aria-pressed={inspect.mode === m}
            className={`px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
              inspect.mode === m
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
      {inspect.hasSkeleton && (
        <>
          <span className="h-4 w-px bg-border" />
          <button
            onClick={() => inspect.setShowSkeleton(!inspect.showSkeleton)}
            title="Afficher le squelette (os du rig) — debug skinning"
            aria-pressed={inspect.showSkeleton}
            className={`flex items-center justify-center rounded p-1.5 transition-colors ${
              inspect.showSkeleton
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            <Bone size={14} />
          </button>
        </>
      )}
      <span className="h-4 w-px bg-border" />
      <button
        onClick={onToggleInfo}
        title="Fiche technique (géométrie, matériaux, UV, textures, extensions)"
        aria-pressed={infoOpen}
        className={`flex items-center justify-center rounded p-1.5 transition-colors ${
          infoOpen
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
        }`}
      >
        <Info size={14} />
      </button>
    </HudGroup>
  );
}
