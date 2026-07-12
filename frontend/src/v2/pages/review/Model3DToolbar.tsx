import { Film, Move3d, Pause, Play, RotateCcw, Save } from 'lucide-react';
import { DEFAULT_TRANSFORM } from './reviewTypes';
import type { Model3DThreeState } from './three/useModel3DThree';

/**
 * Barre d'outils 3D : animations du GLB, transformation (orientation/échelle — masquée une
 * fois le média publié). La navigation caméra (orbite/pan/vol/F/H) est unifiée avec le splat
 * (Phase 17) et vit dans le viewer — plus de toggle « Caméra libre ».
 */
export default function Model3DToolbar({
  m,
  showEditTools,
}: {
  m: Model3DThreeState;
  showEditTools: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
      {m.animations.length > 0 && (
        <>
          <button
            onClick={m.playing ? m.pauseAnim : m.playAnim}
            title={m.playing ? 'Pause' : 'Lire l’animation'}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors ${m.playing ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-secondary/60'}`}
          >
            {m.playing ? <Pause size={14} /> : <Play size={14} />} {m.playing ? 'Pause' : 'Animation'}
          </button>
          {m.animations.length > 1 ? (
            <label className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-muted-foreground">
              <Film size={13} />
              <select
                value={m.currentAnim ?? ''}
                onChange={(e) => m.selectAnim(e.target.value)}
                className="rounded border border-input bg-background px-1 py-0.5 text-xs text-foreground"
              >
                {m.animations.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="text-[11px] text-muted-foreground">{m.currentAnim}</span>
          )}
        </>
      )}
      {showEditTools && (
        <>
          <span className="mx-1 h-5 w-px bg-border" />
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
                value={m.transform[axis]}
                onChange={(e) => m.updateTransform({ [axis]: Number(e.target.value) })}
                className="w-24"
              />
              <span className="w-9 text-right font-mono text-foreground">{m.transform[axis]}°</span>
            </label>
          ))}
          <label className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-muted-foreground">
            <span className="uppercase tracking-wide">éch.</span>
            <input
              type="range"
              min={0.1}
              max={5}
              step={0.1}
              value={m.transform.scale}
              onChange={(e) => m.updateTransform({ scale: Number(e.target.value) })}
              className="w-24"
            />
            <span className="w-8 text-right font-mono text-foreground">{m.transform.scale.toFixed(1)}</span>
          </label>
          <button
            onClick={m.saveTransform}
            className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground"
          >
            <Save size={13} /> {m.savedTf ? 'Enregistré' : 'Enregistrer'}
          </button>
          <button
            onClick={() => m.updateTransform(DEFAULT_TRANSFORM)}
            title="Réinitialiser la transformation"
            className="flex items-center justify-center rounded-md border border-border p-1.5 hover:bg-secondary/60"
          >
            <RotateCcw size={13} />
          </button>
        </>
      )}
    </div>
  );
}
