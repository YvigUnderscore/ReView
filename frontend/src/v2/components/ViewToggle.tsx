// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT } from '../i18n';
import { LayoutGrid, List, RotateCcw } from 'lucide-react';
import { useHasOverride, useViewMode, useViewPref } from '../stores/useViewPref';

/**
 * Bascule cartes ↔ compact d'une liste.
 *
 * Cliquer pose un **écart propre à cette liste** : une grille de plans se lit en vignettes,
 * une liste de tâches en lignes, et un réglage unique ne peut pas répondre pour les deux.
 * Tant qu'aucun écart n'est posé, la liste suit le réglage du compte — le troisième bouton
 * apparaît alors pour l'y ramener, sans quoi rien n'indiquerait qu'un écart existe ni
 * comment le lever.
 */

// Hissé hors du render (règle react-hooks/static-components)
function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      aria-pressed={active}
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
  const t = useT();
  const mode = useViewMode(contextKey);
  const overridden = useHasOverride(contextKey);
  const set = useViewPref((s) => s.set);
  const clear = useViewPref((s) => s.clear);

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
      <ModeButton
        active={mode === 'cards'}
        icon={<LayoutGrid size={16} />}
        label={t('view.cards')}
        onClick={() => set(contextKey, 'cards')}
      />
      <ModeButton
        active={mode === 'compact'}
        icon={<List size={16} />}
        label={t('view.compact')}
        onClick={() => set(contextKey, 'compact')}
      />
      {overridden && (
        <ModeButton
          active={false}
          icon={<RotateCcw size={14} />}
          label={t('view.followAccount')}
          onClick={() => clear(contextKey)}
        />
      )}
    </div>
  );
}
