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
import { filterPeople, personSubtitle, type PersonOption } from '../../lib/peopleSearch';
import { useT } from '../../i18n';

/**
 * Annuaire cliquable : recherche au clavier, visage, et de quoi reconnaître la personne.
 *
 * Extrait du dialogue d'assignation (lot du 25 août), qui était le seul écran à savoir
 * montrer des visages — les autres alignaient un `<select>` natif où vingt-sept comptes
 * nommés « IT Artist » se suivaient sans rien pour les distinguer. La liste vit donc
 * désormais hors du dialogue : un écran qui n'est pas une modale (ou une modale qui a
 * déjà son pied de page) la pose telle quelle.
 *
 * Ce qui a dû être adapté par rapport à l'existant : la recherche ignore les accents et
 * porte sur l'adresse, le poste et le rôle (le dialogue ne cherchait que dans le nom, en
 * casse simple), et chaque ligne porte une ligne secondaire — c'est elle qui départage
 * les homonymes. Le filtrage lui-même est parti dans `lib/peopleSearch`, testable.
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
  /** Personnes à ne pas proposer (déjà membres, déjà destinataires). */
  excludeIds?: readonly number[];
  /** Personnes cochées — la coche n'apparaît que si l'écran gère une sélection. */
  selectedIds?: readonly number[];
  onPick: (person: PersonOption) => void;
  /** Ligne en cours d'écriture serveur : elle reste visible mais ne se re-clique pas. */
  pendingId?: number | null;
  searchLabel?: string;
  emptyLabel?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const search = searchLabel ?? t('assignees.searchPlaceholder');

  // `excludeIds`/`selectedIds` sont des littéraux chez certains appelants : le filtrage
  // se refait alors à chaque rendu, ce qui reste sans effet sur une liste d'annuaire.
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
            {emptyLabel ?? t('assignees.noMatch')}
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
