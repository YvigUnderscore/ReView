// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import Avatar from '../Avatar';
import { initialsFrom } from '../../lib/initials';
import { assigneeName } from '../../lib/assigneeName';
import type { AssigneeRef } from '../../types/entities';
import { useT } from '../../i18n';

/**
 * The faces on a card: who is working on this.
 *
 * Stacked with a slight overlap, as everywhere a team is shown: this is what fits five in the width
 * of a card without crushing the rest. Beyond that, a "+N" token: a longer stack would overflow the
 * card, and nobody reads eight faces at once anyway.
 */

export default function AssigneeStack({
  people,
  size = 22,
  max = 4,
}: {
  people: AssigneeRef[];
  size?: number;
  /** Faces shown before the overflow token. */
  max?: number;
}) {
  const t = useT();
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const hidden = people.length - shown.length;

  return (
    <div
      className="flex items-center"
      // The title carries the whole list: the stack shows four, but hovering must answer
      // "who else?" without having to open anything.
      title={people.map(assigneeName).join(', ')}
      aria-label={t('assignees.label', { count: people.length })}
    >
      {shown.map((person, index) => (
        <span
          key={person.id}
          // The overlap does not apply to the first one: it would stick to the left edge.
          className={index > 0 ? '-ml-1.5' : ''}
          style={{ zIndex: shown.length - index }}
        >
          <span className="block rounded-full ring-2 ring-card">
            <Avatar
              seed={person.id}
              initials={initialsFrom(assigneeName(person))}
              avatarUrl={person.avatarUrl}
              size={size}
            />
          </span>
        </span>
      ))}
      {hidden > 0 && (
        <span
          className="-ml-1.5 flex items-center justify-center rounded-full bg-secondary text-2xs font-medium text-muted-foreground ring-2 ring-card"
          style={{ width: size, height: size }}
        >
          +{hidden}
        </span>
      )}
    </div>
  );
}
