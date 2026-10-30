// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import Avatar from '../Avatar';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { initialsFrom } from '../../lib/initials';
import { ROLE_LABEL_KEY } from '../../lib/userStatus';
import { emptyPeopleReason, filterPeople, personSubtitle, type PersonOption } from '../../lib/peopleSearch';
import { useT } from '../../i18n';

/**
 * Clickable directory: keyboard search, faces, and what is needed to recognise the person.
 *
 * Extracted from the assignment dialog (batch of 25 August), which was the only screen able to show faces: the others
 * lined up a native `<select>` where twenty-seven accounts named "IT Artist" followed one another with nothing to tell
 * them apart. The list now lives outside the dialog: a screen that is not a modal (or a modal that already has its own
 * footer) places it as is.
 *
 * What had to be adapted from the existing version: the search ignores accents and covers the address, the role and the
 * position (the dialog only searched the name, case-insensitively), and each row carries a secondary line, which is what
 * tells namesakes apart. The filtering itself moved into `lib/peopleSearch`, where it is testable.
 */
export default function PeopleList({
  people,
  excludeIds,
  selectedIds,
  onPick,
  pendingId = null,
  searchLabel,
  emptyLabel,
  autoFocus = true,
  className,
}: {
  people: readonly PersonOption[];
  /** People not to offer (already members, already recipients). */
  excludeIds?: readonly number[];
  /** Checked people: the tick only appears if the screen handles a selection. */
  selectedIds?: readonly number[];
  onPick: (person: PersonOption) => void;
  /** Row currently being written to the server: it stays visible but cannot be clicked again. */
  pendingId?: number | null;
  searchLabel?: string;
  emptyLabel?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const search = searchLabel ?? t('assignees.searchPlaceholder');

  // Some callers pass `excludeIds`/`selectedIds` as literals: the filtering is then redone on every render, which
  // costs nothing noticeable on a directory list.
  const visible = useMemo(() => filterPeople(people, { query, excludeIds }), [people, query, excludeIds]);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          autoFocus={autoFocus}
          className="pl-8"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={search}
          aria-label={search}
        />
      </div>
      <div className="custom-scrollbar max-h-72 space-y-0.5 overflow-y-auto">
        {visible.length === 0 && (
          <p className="px-1 py-4 text-center text-sm text-muted-foreground">
            {emptyPeopleReason(query) === 'no-candidates'
              ? (emptyLabel ?? t('assignees.noMatch'))
              : t('assignees.noMatch')}
          </p>
        )}
        {visible.map((person) => {
          const checked = selectedIds?.includes(person.id) ?? false;
          const subtitle = personSubtitle(person);
          return (
            <button
              key={person.id}
              type="button"
              onClick={() => onPick(person)}
              disabled={pendingId === person.id}
              aria-pressed={selectedIds ? checked : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-50',
                checked ? 'bg-primary/10' : 'hover:bg-secondary/60',
              )}
            >
              <Avatar
                seed={person.id}
                initials={person.initials ?? initialsFrom(person.name)}
                avatarUrl={person.avatarUrl}
                size={26}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{person.name}</span>
                {subtitle && (
                  <span className="block truncate text-2xs text-muted-foreground">{subtitle}</span>
                )}
              </span>
              {person.role && (
                <Badge variant="muted" className="shrink-0">
                  {t(ROLE_LABEL_KEY[person.role])}
                </Badge>
              )}
              {checked && <Check size={15} className="shrink-0 text-primary" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
