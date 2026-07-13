import { Play } from 'lucide-react';
import type { DebugColorMode } from '../scene/effects/debugColor';
import type { RevealConfig } from '../presentation/usePresentation';
import type { RevealType } from '../scene/effects/reveal';
import type { LodMode } from '../scene/lod';
import { HudGroup } from '../../hud/ViewerHud';
import HudNumber from '../../hud/HudNumber';

const LODS: { value: LodMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'on', label: 'Activé' },
  { value: 'off', label: 'Désactivé' },
  { value: 'streaming', label: 'Streaming' },
];

const REVEALS: { value: RevealType | 'none'; label: string }[] = [
  { value: 'none', label: 'Aucun' },
  { value: 'fade', label: 'Fondu' },
  { value: 'sweep', label: 'Balayage' },
  { value: 'dissolve', label: 'Dissolution' },
];

const DEBUGS: { value: DebugColorMode; label: string }[] = [
  { value: 'none', label: 'Couleurs' },
  { value: 'normal', label: 'Normales' },
  { value: 'depth', label: 'Profondeur' },
];

/**
 * Réglages live du viewer splat (10.G-V1/V6, togglable) : culling, debug color (inspection
 * locale) et effet de reveal (type + durée — persisté par le gestionnaire via « Présentation »,
 * re-jouable localement). Réglages de session, non persistés en eux-mêmes.
 */
export default function ViewerSettingsPanel({
  cullingOff,
  onCullingOff,
  debugMode,
  onDebugMode,
  reveal,
  onReveal,
  onReplayReveal,
  lodMode,
  onLodMode,
}: {
  cullingOff: boolean;
  onCullingOff: (off: boolean) => void;
  debugMode: DebugColorMode;
  onDebugMode: (mode: DebugColorMode) => void;
  reveal: RevealConfig | null;
  onReveal: (reveal: RevealConfig | null) => void;
  onReplayReveal: () => void;
  lodMode: LodMode;
  onLodMode: (mode: LodMode) => void;
}) {
  return (
    <HudGroup className="max-w-64">
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

      <label
        className="flex items-center gap-1.5 text-muted-foreground"
        title="Niveau de détail : Auto active le LOD sous 15 fps pendant 5 s (relâché au-dessus de 25 fps) ; Streaming charge les pages à la demande — persisté avec la présentation"
      >
        LOD
        <select
          value={lodMode}
          onChange={(e) => onLodMode(e.target.value as LodMode)}
          className="rounded border border-border bg-background/60 px-1 py-0.5 text-[11px] text-foreground"
        >
          {LODS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <label
        className="flex items-center gap-1.5 text-muted-foreground"
        title="Colorisation d'inspection (locale) : normales des gaussiennes ou heatmap de profondeur"
      >
        Debug
        <select
          value={debugMode}
          onChange={(e) => onDebugMode(e.target.value as DebugColorMode)}
          className="rounded border border-border bg-background/60 px-1 py-0.5 text-[11px] text-foreground"
        >
          {DEBUGS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>

      <label
        className="flex items-center gap-1.5 text-muted-foreground"
        title="Effet d'apparition à l'ouverture — persisté avec la présentation (bouton « Présentation »)"
      >
        Reveal
        <select
          value={reveal?.type ?? 'none'}
          onChange={(e) => {
            const type = e.target.value as RevealType | 'none';
            onReveal(type === 'none' ? null : { type, durationMs: reveal?.durationMs ?? 2500 });
          }}
          className="rounded border border-border bg-background/60 px-1 py-0.5 text-[11px] text-foreground"
        >
          {REVEALS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      {reveal && (
        <>
          <HudNumber
            label="Durée"
            hint="Durée de l'effet d'apparition (secondes)"
            value={Number((reveal.durationMs / 1000).toFixed(1))}
            onChange={(s) => onReveal({ ...reveal, durationMs: Math.round(s * 1000) })}
            min={0.5}
            max={10}
            step={0.1}
            unit="s"
          />
          <button
            onClick={onReplayReveal}
            title="Rejouer l'effet d'apparition"
            className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <Play size={11} /> Rejouer
          </button>
        </>
      )}
    </HudGroup>
  );
}
