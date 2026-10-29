// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { LayoutGrid, List, Search } from 'lucide-react';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { CLIENT_SORTS, type ClientSort } from './clientBrowseModel';
import { useT, type Tr } from '../../i18n';

/**
 * Finding a shot in a page of two hundred: search, sort, and choose between grid and list.
 *
 * No media-type filter: on a share link the type is already readable on the tile, and one
 * more menu for three cases adds more clutter than it saves.
 */

/** Sort labels: a function, never a module-level table, since a table would freeze the language. */
const sortLabels = (t: Tr): Record<ClientSort, string> => ({
  recent: t('client.sort.recent'),
  name: t('client.sort.name'),
  production: t('client.sort.production'),
});

export default function ClientListControls({
  query,
  onQuery,
  sort,
  onSort,
  view,
  onView,
}: {
  query: string;
  onQuery: (value: string) => void;
  sort: ClientSort;
  onSort: (sort: ClientSort) => void;
  view: 'grid' | 'list';
  onView: (view: 'grid' | 'list') => void;
}) {
  const t = useT();
  const labels = sortLabels(t);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search
          size={14}
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('client.search')}
          aria-label={t('client.search')}
          className="pl-8"
        />
      </div>

      <Select
        value={sort}
        onChange={(e) => onSort(e.target.value as ClientSort)}
        aria-label={t('client.sort.recent')}
        className="w-auto"
      >
        {CLIENT_SORTS.map((value) => (
          <option key={value} value={value}>
            {labels[value]}
          </option>
        ))}
      </Select>

      <div className="flex rounded-md border border-border">
        {(
          [
            { id: 'grid' as const, icon: LayoutGrid, label: t('client.view.grid') },
            { id: 'list' as const, icon: List, label: t('client.view.list') },
          ] satisfies { id: 'grid' | 'list'; icon: typeof List; label: string }[]
        ).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onView(id)}
            title={label}
            aria-label={label}
            aria-pressed={view === id}
            className={`px-2 py-1.5 transition-colors ${
              view === id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}
