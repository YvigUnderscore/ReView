import { LayoutGrid, List } from 'lucide-react';
import { useViewPref, type ViewMode } from '../stores/useViewPref';

/**
 * Bascule cartes ↔ compact pour une liste donnée. La préférence est mémorisée
 * par `contextKey` (ex. « projects », « assets:42 »).
 */
export default function ViewToggle({ contextKey }: { contextKey: string }) {
  const mode = useViewPref((s) => s.modes[contextKey] ?? (localStorage.getItem('review:view:' + contextKey) as ViewMode) ?? 'cards');
  const set = useViewPref((s) => s.set);

  const Btn = ({ value, icon, label }: { value: ViewMode; icon: React.ReactNode; label: string }) => (
    <button
      title={label}
      aria-label={label}
      onClick={() => set(contextKey, value)}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
        mode === value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
      <Btn value="cards" icon={<LayoutGrid size={16} />} label="Vue cartes" />
      <Btn value="compact" icon={<List size={16} />} label="Vue compacte" />
    </div>
  );
}

/** Hook utilitaire : lit la préférence courante pour un contexte. */
export function useViewMode(contextKey: string): ViewMode {
  return useViewPref((s) => s.modes[contextKey] ?? (localStorage.getItem('review:view:' + contextKey) as ViewMode) ?? 'cards');
}
