// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import Avatar from '../Avatar';
import { initialsFrom } from '../../lib/initials';
import { assigneeName } from '../../lib/assigneeName';
import type { AssigneeRef } from '../../types/entities';
import { useT } from '../../i18n';

/**
 * Les visages d'une carte : qui s'occupe de ça.
 *
 * Empilés avec un léger recouvrement, comme partout où l'on montre une équipe — c'est ce
 * qui permet d'en loger cinq dans la largeur d'une carte sans écraser le reste. Au-delà,
 * un jeton « +N » : allonger la pile ferait déborder la carte, et personne ne lit huit
 * visages d'un coup de toute façon.
 */

export default function AssigneeStack({
  people,
  size = 22,
  max = 4,
}: {
  people: AssigneeRef[];
  size?: number;
  /** Visages montrés avant le jeton de débordement. */
  max?: number;
}) {
  const t = useT();
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const hidden = people.length - shown.length;

  return (
    <div
      className="flex items-center"
      // Le titre porte la liste entière : la pile en montre quatre, mais survoler doit
      // répondre à « qui d'autre ? » sans avoir à ouvrir quoi que ce soit.
      title={people.map(assigneeName).join(', ')}
      aria-label={t('assignees.label', { count: people.length })}
    >
      {shown.map((person, index) => (
        <span
          key={person.id}
          // Le recouvrement ne s'applique pas au premier : il collerait au bord gauche.
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
