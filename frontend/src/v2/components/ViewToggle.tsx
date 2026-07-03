import { LayoutGrid, List } from 'lucide-react';
import { useViewPref, type ViewMode } from '../stores/useViewPref';

/**
 * Bascule cartes ↔ compact pour une liste donnée. La préférence est mémorisée
 * par `contextKey` (ex. « projects », « assets:42 »).
 */

// Hissé hors du render (règle react-hooks/static-components)
function ModeButton({ active, icon, label, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
        active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'
      }`}
    >
      {icon}
    </button>
  );
}

export default function ViewToggle({ contextKey }: { contextKey: string }) {
  const mode = useViewPref((s) => s.modes[contextKey] ?? (localStorage.getItem('review:view:' + contextKey) as ViewMode) ?? 'cards');
  const set = useViewPref((s) => s.set);

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
      <ModeButton active={mode === 'cards'} icon={<LayoutGrid size={16} />} label="Vue cartes" onClick={() => set(contextKey, 'cards')} />
      <ModeButton active={mode === 'compact'} icon={<List size={16} />} label="Vue compacte" onClick={() => set(contextKey, 'compact')} />
    </div>
  );
}
