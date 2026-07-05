import { useEffect, useState } from 'react';
import { Move3d, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { DEFAULT_TRANSFORM, type Transform } from './reviewTypes';
import type { SplatViewer } from './useSplat';

/**
 * Outil de transformation d'un splat avant publication (10.G) : orientation (yaw/pitch/roll)
 * et échelle, preview live via le viewer Spark (SplatMesh = Object3D), persisté dans
 * `metadata.splatTransform`. Affiché seulement en mode avant-publication pour un gestionnaire.
 */
export default function SplatTransformToolbar({
  splat,
  mediaId,
  saved,
  onSaved,
}: {
  splat: SplatViewer;
  mediaId: number;
  saved: Transform | null;
  onSaved: (transform: Transform | null) => void;
}) {
  const { applyTransform } = splat;
  const [tf, setTf] = useState<Transform>(saved ?? DEFAULT_TRANSFORM);
  const [busy, setBusy] = useState(false);

  // Preview live : applique la transformation courante au splat.
  useEffect(() => {
    applyTransform(tf);
  }, [tf, applyTransform]);

  const isDefault = tf.yaw === 0 && tf.pitch === 0 && tf.roll === 0 && tf.scale === DEFAULT_TRANSFORM.scale;

  const persist = async (next: Transform | null) => {
    setBusy(true);
    try {
      await api.patch(`/api/media/${mediaId}/transform`, { transform: next });
      onSaved(next);
      toast.success(next ? 'Transformation enregistrée' : 'Transformation réinitialisée');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur à l'enregistrement de la transformation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
      <Move3d size={14} className="text-muted-foreground" />
      {(['yaw', 'pitch', 'roll'] as const).map((axis) => (
        <label
          key={axis}
          className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-muted-foreground"
        >
          <span className="w-9 uppercase tracking-wide">{axis}</span>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={tf[axis]}
            onChange={(e) => setTf((t) => ({ ...t, [axis]: Number(e.target.value) }))}
            className="w-24 accent-primary"
          />
          <span className="w-9 text-right font-mono text-foreground">{tf[axis]}°</span>
        </label>
      ))}
      <label className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-muted-foreground">
        <span className="uppercase tracking-wide">éch.</span>
        <input
          type="range"
          min={0.1}
          max={5}
          step={0.1}
          value={tf.scale}
          onChange={(e) => setTf((t) => ({ ...t, scale: Number(e.target.value) }))}
          className="w-24 accent-primary"
        />
        <span className="w-8 text-right font-mono text-foreground">{tf.scale.toFixed(1)}</span>
      </label>
      <button
        onClick={() => void persist(tf)}
        disabled={busy || isDefault}
        className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
      >
        <Save size={13} /> Enregistrer
      </button>
      <button
        onClick={() => {
          setTf(DEFAULT_TRANSFORM);
          void persist(null);
        }}
        disabled={busy}
        title="Réinitialiser la transformation"
        className="flex items-center justify-center rounded-md border border-border p-1.5 hover:bg-secondary/60 disabled:opacity-50"
      >
        <RotateCcw size={13} />
      </button>
    </div>
  );
}
