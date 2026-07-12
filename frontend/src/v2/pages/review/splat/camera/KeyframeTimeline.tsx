import { Orbit, Plus, Save, Trash2, X } from 'lucide-react';
import type { CameraEasing } from '../../reviewTypes';
import { HudGroup } from '../../hud/ViewerHud';
import type { CameraKeyframesState } from './useCameraKeyframes';

const EASINGS: { value: CameraEasing; label: string }[] = [
  { value: 'linear', label: 'Linéaire' },
  { value: 'ease-in', label: 'Accélère' },
  { value: 'ease-out', label: 'Décélère' },
  { value: 'ease-in-out', label: 'Doux' },
];

const fmtS = (ms: number) => `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}s`;

/**
 * Timeline de l'éditeur keyframe caméra (10.G-V5), réservée au gestionnaire : ajouter une pose
 * depuis la vue courante, preset orbite, easing par segment, suppression, scrub, boucle, et
 * enregistrement de la présentation (rejouée pour tous à l'ouverture).
 */
export default function KeyframeTimeline({
  kf,
  onOrbitPreset,
  onSave,
  onClear,
  busy,
}: {
  kf: CameraKeyframesState;
  onOrbitPreset: () => void;
  /** Persistance de la présentation (splat). Omis → animation de session seule (viewer 3D). */
  onSave?: () => void;
  onClear?: () => void;
  busy?: boolean;
}) {
  return (
    <HudGroup>
      <span className="font-medium text-foreground">Animation</span>
      <button
        onClick={kf.addFromView}
        title="Ajouter une pose depuis la vue courante"
        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      >
        <Plus size={12} /> Pose
      </button>
      <button
        onClick={onOrbitPreset}
        title="Preset : un tour d'orbite complet autour de la cible courante"
        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      >
        <Orbit size={13} /> Orbite
      </button>

      {kf.keyframes.map((k, i) => (
        <span
          key={`${i}-${k.t}`}
          className="flex items-center gap-1 rounded-md bg-secondary/40 px-1.5 py-0.5"
        >
          <button
            onClick={() => kf.scrub(k.t)}
            title={`Aller à la pose ${i + 1} (${fmtS(k.t)})`}
            className="font-mono text-foreground hover:text-primary"
          >
            {i + 1}
          </button>
          {i < kf.keyframes.length - 1 && (
            <select
              value={k.easing}
              onChange={(e) => kf.setEasing(i, e.target.value as CameraEasing)}
              title="Easing du segment partant de cette pose"
              className="rounded border border-border bg-background/60 px-0.5 py-0 text-[10px] text-muted-foreground"
            >
              {EASINGS.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => kf.remove(i)}
            title="Supprimer cette pose"
            className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X size={11} />
          </button>
        </span>
      ))}

      {kf.keyframes.length >= 2 && (
        <>
          <input
            type="range"
            min={0}
            max={kf.duration}
            value={Math.min(kf.timeMs, kf.duration)}
            onChange={(e) => kf.scrub(Number(e.target.value))}
            title="Parcourir l'animation (scrub)"
            className="h-1 w-24 accent-primary"
          />
          <label
            className="flex cursor-pointer items-center gap-1 text-muted-foreground"
            title="Rejouer en boucle"
          >
            <input
              type="checkbox"
              checked={kf.loop}
              onChange={(e) => kf.setLoop(e.target.checked)}
              className="accent-primary"
            />
            Boucle
          </label>
          <label
            className="flex cursor-pointer items-center gap-1 text-muted-foreground"
            title="Interpolation par courbes lissées (Catmull-Rom) au lieu de segments droits"
          >
            <input
              type="checkbox"
              checked={kf.smooth}
              onChange={kf.toggleSmooth}
              className="accent-primary"
            />
            Courbes
          </label>
        </>
      )}

      {onSave && (
        <>
          <span className="h-4 w-px bg-border" />
          <button
            onClick={onSave}
            disabled={busy}
            title="Enregistrer la présentation (caméra, DoF, animation) — rejouée pour tous à l'ouverture"
            className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground disabled:opacity-50"
          >
            <Save size={12} /> Présentation
          </button>
          {onClear && (
            <button
              onClick={onClear}
              disabled={busy}
              title="Effacer la présentation persistée"
              className="flex items-center justify-center rounded-md border border-border p-1 text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
            >
              <Trash2 size={12} />
            </button>
          )}
        </>
      )}
    </HudGroup>
  );
}
