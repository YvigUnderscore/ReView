import { Columns3 } from 'lucide-react';
import { HudGroup } from '../hud/ViewerHud';
import type { SplatCompareState } from './useSplatCompare';

const shortName = (name: string) => (name.length > 22 ? `${name.slice(0, 20)}…` : name);

/**
 * Barre de comparaison des splats d'une version (10.G-V8) : onglets A/B (fondu) + « Voir
 * tous » (côte à côte). Montée pour tous les spectateurs quand la version porte plusieurs
 * splats, hors mode édition.
 */
export default function CompareBar({ compare }: { compare: SplatCompareState }) {
  return (
    <HudGroup>
      <span className="text-muted-foreground">Comparer</span>
      {compare.splats.map((m) => (
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
        title="Afficher tous les splats de la version côte à côte"
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
