// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import Avatar from '../Avatar';
import { initialsFrom } from '../../lib/initials';
import { assigneeName } from '../../lib/assigneeName';
import type { AssigneeRef } from '../../types/entities';
import { useT } from '../../i18n';

/**
 * Qui travaille dans le périmètre — et à quel titre.
 *
 * L'origine compte : sur une séquence, presque personne n'est assigné à la séquence
 * elle-même, tout le monde l'est à ses plans ou aux tâches de ses plans. La pastille
 * distingue donc ceux qui en répondent directement, et le survol dit le reste.
 */

/** L'origine d'une personne dans le périmètre — sert à trier, et à l'expliquer au survol. */
export type Origin = 'direct' | 'child' | 'task';

export interface ScopePerson extends AssigneeRef {
  origins: Origin[];
  count: number;
}

const ORIGIN_LABEL: Record<
  Origin,
  'assignees.origin.direct' | 'assignees.origin.child' | 'assignees.origin.task'
> = {
  direct: 'assignees.origin.direct',
  child: 'assignees.origin.child',
  task: 'assignees.origin.task',
};

export default function EntityTeamList({ people }: { people: ScopePerson[] }) {
  const t = useT();

  if (people.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('entity.header.noPeople')}</p>;
  }

  return (
    <ul className="space-y-1">
      {people.map((person) => (
        <li
          key={person.id}
          title={person.origins.map((o) => t(ORIGIN_LABEL[o])).join(' · ')}
          className="flex items-center gap-2 rounded-md px-1 py-0.5"
        >
          <Avatar
            seed={person.id}
            initials={initialsFrom(assigneeName(person))}
            avatarUrl={person.avatarUrl}
            size={24}
          />
          <span className="min-w-0 flex-1 truncate text-xs">{assigneeName(person)}</span>
          {person.origins.includes('direct') && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          )}
        </li>
      ))}
    </ul>
  );
}
