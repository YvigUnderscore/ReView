import { CircleDot, Cuboid, Eraser, Focus, Plus, X } from 'lucide-react';
import type { VolumesState } from './useVolumes';

/**
 * Barre des volumes de crop (10.G) : ajout boîte/sphère, chips par volume (sélection pour
 * attacher le gizmo, bascule creuser/isoler, retrait). Montée sous la toolbar de l'éditeur.
 * Tokens de thème + lucide, cohérent avec les toolbars de review.
 */
export default function VolumesBar({ volumes }: { volumes: VolumesState }) {
  return (
    <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-md border border-border bg-card/85 px-3 py-1.5 text-xs shadow-sm backdrop-blur">
      <span className="text-muted-foreground">Volumes</span>
      <button
        onClick={() => void volumes.add('box')}
        title="Ajouter un volume boîte (creuser/isoler au choix)"
        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      >
        <Plus size={12} />
        <Cuboid size={13} /> Boîte
      </button>
      <button
        onClick={() => void volumes.add('sphere')}
        title="Ajouter un volume sphère (creuser/isoler au choix)"
        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      >
        <Plus size={12} />
        <CircleDot size={13} /> Sphère
      </button>

      {volumes.volumes.map((v, i) => {
        const active = volumes.activeId === v.id;
        const ShapeIcon = v.shape === 'box' ? Cuboid : CircleDot;
        const ModeIcon = v.mode === 'delete' ? Eraser : Focus;
        return (
          <span
            key={v.id}
            className={`flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1 ${
              active ? 'ring-1 ring-primary' : ''
            }`}
          >
            <button
              onClick={() => volumes.select(v.id)}
              title={active ? 'Détacher le gizmo du volume' : 'Attacher le gizmo à ce volume'}
              className={`flex items-center gap-1.5 font-medium ${
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ShapeIcon size={13} /> {v.shape === 'box' ? 'Boîte' : 'Sphère'} {i + 1}
            </button>
            <button
              onClick={() => volumes.toggleMode(v.id)}
              title={
                v.mode === 'delete'
                  ? 'Creuse (supprime l’intérieur) — basculer vers isoler'
                  : 'Isole (garde l’intérieur) — basculer vers creuser'
              }
              className={`flex items-center gap-1 rounded px-1 py-0.5 ${
                v.mode === 'delete' ? 'text-destructive' : 'text-primary'
              } hover:bg-secondary`}
            >
              <ModeIcon size={12} /> {v.mode === 'delete' ? 'Creuser' : 'Isoler'}
            </button>
            <button
              onClick={() => volumes.remove(v.id)}
              title="Retirer le volume"
              className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X size={12} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
