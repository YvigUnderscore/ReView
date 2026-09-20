// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useT } from '../../i18n';
import { SettingsSearchContext, useSettingsSearch } from './settingsSearchContext';

/**
 * La barre de recherche des pages de réglages, et le fournisseur qui la relie aux cartes.
 *
 * L'administration savait chercher parmi ses sections ; les réglages d'un projet et ceux
 * d'un profil, non — on y descendait une colonne de quinze cartes en lisant les titres.
 * Une seule mécanique sert désormais les trois familles : la barre pose la question, chaque
 * `SettingsCard` y répond pour elle-même, et le compte des réponses permet de dire
 * « aucun réglage » plutôt que de laisser une page vide.
 *
 * Le libellé est celui de l'administration (`admin.search.*`) : c'est le même message, déjà
 * relu dans les quatorze langues — le dupliquer sous un autre nom n'aurait ajouté que
 * quatorze traductions à maintenir.
 */
export function SettingsSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const shown = useRef(new Set<string>());
  const [visible, setVisible] = useState(0);

  // Stable : la carte l'appelle depuis un effet, une identité changeante le relancerait
  // à chaque rendu. `Set.size` ne change pas quand rien ne change, et React s'arrête là.
  const report = useCallback((id: string, isVisible: boolean) => {
    if (isVisible) shown.current.add(id);
    else shown.current.delete(id);
    setVisible(shown.current.size);
  }, []);

  const value = useMemo(() => ({ query, setQuery, report, visible }), [query, report, visible]);
  return <SettingsSearchContext.Provider value={value}>{children}</SettingsSearchContext.Provider>;
}

/** Le champ de recherche. Même dessin dans l'administration, un projet et un profil. */
export function SettingsSearchBar({
  value,
  onChange,
  className,
}: {
  /** Fournis pour une barre pilotée de l'extérieur (barre latérale d'administration). */
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
}) {
  const t = useT();
  const ctx = useSettingsSearch();
  const query = value ?? ctx.query;
  const setQuery = onChange ?? ctx.setQuery;
  return (
    <div className={`relative ${className ?? ''}`}>
      <Search
        size={14}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('admin.search.placeholder')}
        aria-label={t('admin.search.placeholder')}
        className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

/** « Aucun réglage » — affiché quand la recherche ne laisse plus rien à l'écran. */
export function SettingsSearchEmpty() {
  const t = useT();
  const { query, visible } = useSettingsSearch();
  if (!query.trim() || visible > 0) return null;
  return <p className="px-1 py-6 text-sm text-muted-foreground">{t('admin.search.empty')}</p>;
}
