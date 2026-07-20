import { useState } from 'react';
import { ListFilter, Trash2, Check, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useSavedViews, filtersEqual, normalizeFilters } from '../lib/useSavedViews';

/**
 * Menu des vues de liste sauvegardées (42.A5 — №73). Compact (règle UI simple) : un seul
 * déclencheur dans la barre de filtres. Applique/enregistre/supprime des jeux de filtres
 * nommés, persistés par compte via `useSavedViews`.
 */
export default function SavedViewsMenu({
  scope,
  current,
  onApply,
}: {
  scope: string;
  /** Filtres actuels de la liste (clé → valeur, « » = inactif). */
  current: Record<string, string>;
  /** Applique un jeu de filtres sauvegardé à la liste. */
  onApply: (filters: Record<string, string>) => void;
}) {
  const { views, save, remove } = useSavedViews(scope);
  const [name, setName] = useState('');
  const hasFilters = Object.keys(normalizeFilters(current)).length > 0;
  const active = views.find((v) => filtersEqual(v.filters, current));

  const doSave = () => {
    if (!name.trim() || !hasFilters) return;
    save(name, current);
    setName('');
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Vues sauvegardées"
          className={`flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-secondary ${
            active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ListFilter size={13} />
          {active ? active.name : 'Vues'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Vues sauvegardées
        </p>
        {views.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">Aucune vue enregistrée.</p>
        ) : (
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {views.map((v) => {
              const isActive = v.id === active?.id;
              return (
                <li key={v.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onApply(v.filters)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary ${
                      isActive ? 'text-primary' : ''
                    }`}
                  >
                    <Check size={13} className={isActive ? '' : 'opacity-0'} />
                    <span className="truncate">{v.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(v.id)}
                    title="Supprimer la vue"
                    className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSave()}
            placeholder={hasFilters ? 'Nommer la vue actuelle…' : 'Filtrez d’abord la liste'}
            disabled={!hasFilters}
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={doSave}
            disabled={!name.trim() || !hasFilters}
            title="Enregistrer la vue actuelle"
          >
            <Plus size={14} />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
