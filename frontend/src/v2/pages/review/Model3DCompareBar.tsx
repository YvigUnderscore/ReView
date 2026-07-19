import { Columns3 } from 'lucide-react';
import { HudGroup } from './hud/ViewerHud';
import type { Model3DCompareState } from './three/useModel3DCompare';

const shortName = (name: string) => (name.length > 22 ? `${name.slice(0, 20)}…` : name);

/**
 * Barre de comparaison A/B des modèles 3D d'une version (39.E) : onglets A/B (fondu, caméra liée)
 * + « Voir tous » (côte à côte). Montée pour tous les spectateurs quand la version porte plusieurs
 * modèles, hors mode édition.
 */
export default function Model3DCompareBar({ compare }: { compare: Model3DCompareState }) {
  return (
    <HudGroup>
      <span className="text-muted-foreground">Comparer</span>
      {compare.models.map((m) => (
        <button
          key={m.id}
          onClick={() => void compare.switchTo(m.id)}
          disabled={compare.busy}
          title={m.originalName}
          aria-pressed={compare.mode === 'single' && compare.activeId === m.id}
          className={`rounded px-2 py-1 font-medium transition-colors disabled:opacity-50 ${
            compare.mode === 'single' && compare.activeId === m.id
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          }`}
        >
          {shortName(m.originalName)}
        </button>
      ))}
      <button
        onClick={() => void compare.viewAll()}
        disabled={compare.busy}
        title="Afficher tous les modèles de la version côte à côte"
        aria-pressed={compare.mode === 'all'}
        className={`flex items-center gap-1 rounded px-2 py-1 font-medium transition-colors disabled:opacity-50 ${
          compare.mode === 'all'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
        }`}
      >
        <Columns3 size={13} /> Voir tous
      </button>
    </HudGroup>
  );
}
