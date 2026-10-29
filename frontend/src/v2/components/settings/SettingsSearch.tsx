// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useT } from '../../i18n';
import { SettingsSearchContext, useSettingsSearch } from './settingsSearchContext';

/**
 * The search bar of the settings pages, and the provider that connects it to the cards.
 *
 * Administration could search among its sections; a project's and a profile's settings could not: one went down a column of
 * fifteen cards reading the titles. A single mechanism now serves the three families: the bar asks the question, each
 * `SettingsCard` answers it for itself, and the count of answers makes it possible to say "no settings" rather than leave
 * an empty page.
 *
 * The label is that of administration (`admin.search.*`): it is the same message, already reviewed in the fourteen languages.
 * Duplicating it under another name would only have added fourteen translations to maintain.
 */
export function SettingsSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const shown = useRef(new Set<string>());
  const [visible, setVisible] = useState(0);

  // Stable: the card calls it from an effect, and a changing identity would re-run it on every render. `Set.size` does not
  // change when nothing changes, and React stops there.
  const report = useCallback((id: string, isVisible: boolean) => {
    if (isVisible) shown.current.add(id);
    else shown.current.delete(id);
    setVisible(shown.current.size);
  }, []);

  const value = useMemo(() => ({ query, setQuery, report, visible }), [query, report, visible]);
  return <SettingsSearchContext.Provider value={value}>{children}</SettingsSearchContext.Provider>;
}

/** The search field. Same drawing in administration, a project and a profile. */
export function SettingsSearchBar({
  value,
  onChange,
  className,
}: {
  /** Provided for a bar driven from outside (administration sidebar). */
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

/** "No settings": shown when the search leaves nothing on screen. */
export function SettingsSearchEmpty() {
  const t = useT();
  const { query, visible } = useSettingsSearch();
  if (!query.trim() || visible > 0) return null;
  return <p className="px-1 py-6 text-sm text-muted-foreground">{t('admin.search.empty')}</p>;
}
