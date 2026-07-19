import { Save, Sun, Trash2 } from 'lucide-react';
import { HudGroup, HudIconButton } from './hud/ViewerHud';
import HudNumber from './hud/HudNumber';
import type { Model3DLightingState } from './three/useModel3DLighting';

/**
 * Barre d'éclairage HDRI du viewer 3D (Phase 29) : choix d'un environnement de la bibliothèque
 * instance, exposition, rotation Y, fond HDRI on/off. Le gestionnaire enregistre le réglage par
 * défaut (rejoué pour tous) ou l'efface ; les spectateurs tweakent en session (non persisté).
 */
export default function LightingBar({ lighting }: { lighting: Model3DLightingState }) {
  const { cfg, setCfg, hdris, busy, save, clear } = lighting;
  return (
    <HudGroup>
      <Sun size={14} className="text-muted-foreground" />
      <label
        className="flex items-center gap-1 text-muted-foreground"
        title="Environnement HDRI (éclairage image)"
      >
        HDRI
        <select
          value={cfg.hdriId ?? ''}
          onChange={(e) => setCfg({ ...cfg, hdriId: e.target.value || undefined })}
          className="max-w-32 rounded border border-border bg-background/60 px-1 py-0.5 text-[11px] text-foreground"
        >
          <option value="">Aucun</option>
          {hdris.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </label>
      <HudNumber
        label="Expo"
        hint="Exposition (tone mapping)"
        value={Number(cfg.exposure.toFixed(2))}
        onChange={(exposure) => setCfg({ ...cfg, exposure })}
        min={0}
        max={10}
        step={0.05}
        pixelsPerStep={6}
      />
      <HudNumber
        label="Rot°"
        hint="Rotation de l'environnement (axe Y)"
        value={Math.round(cfg.rotationDeg)}
        onChange={(rotationDeg) => setCfg({ ...cfg, rotationDeg })}
        min={-180}
        max={180}
        step={1}
      />
      <button
        onClick={() => setCfg({ ...cfg, showBackground: !cfg.showBackground })}
        title="Afficher l'HDRI en fond"
        aria-pressed={cfg.showBackground}
        className={`rounded border border-border px-1.5 py-0.5 font-medium ${
          cfg.showBackground
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
        }`}
      >
        Fond
      </button>
      <button
        onClick={() => setCfg({ ...cfg, groundShadow: !cfg.groundShadow })}
        title="Sol récepteur d'ombres portées (key light)"
        aria-pressed={cfg.groundShadow}
        className={`rounded border border-border px-1.5 py-0.5 font-medium ${
          cfg.groundShadow
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
        }`}
      >
        Ombres
      </button>
      {save && (
        <>
          <span className="h-4 w-px bg-border" />
          <button
            onClick={() => void save()}
            disabled={busy}
            title="Enregistrer l'éclairage par défaut — rejoué pour tous à l'ouverture"
            className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground disabled:opacity-50"
          >
            <Save size={12} /> Défaut
          </button>
          {clear && (
            <HudIconButton
              icon={Trash2}
              hint="Effacer l'éclairage par défaut"
              onClick={() => void clear()}
              disabled={busy}
            />
          )}
        </>
      )}
    </HudGroup>
  );
}
