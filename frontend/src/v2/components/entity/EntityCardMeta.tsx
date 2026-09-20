// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Eye } from 'lucide-react';
import AssigneeStack from './AssigneeStack';
import { timeAgo } from '../../lib/time';
import DepartmentChips from './DepartmentChips';
import type { AssigneeRef, DepartmentRef } from '../../types/entities';
import { useT } from '../../i18n';
import { intlLocale } from '../../i18n';

/**
 * Ce qu'une carte dit d'une entité en plus de son nom.
 *
 * Une carte n'annonçait que « douze tâches ». Or en balayant une grille de deux cents
 * plans, on cherche à répondre à quatre questions et toujours les mêmes : de quoi s'agit-il
 * (la description), qui s'en occupe (les visages), y a-t-il quelque chose à regarder (la
 * pastille d'attente), et depuis quand ça n'a pas bougé (la date).
 *
 * L'ordre de lecture est délibéré et le même dans les deux vues : le texte d'abord, les
 * gens ensuite, l'urgence et le temps en fin de ligne, là où l'œil revient. Deux niveaux
 * seulement — le nom, puis cette bande — pour que la carte reste lisible d'un coup d'œil.
 */

export interface EntityMeta {
  description?: string | null;
  assignees?: AssigneeRef[];
  /** Étapes que traverse l'entité — déclarées nulle part visible jusqu'ici. */
  departments?: DepartmentRef[];
  /** Livraisons publiées qu'aucune décision de review n'a tranchées. */
  awaitingReview?: number;
  updatedAt?: string;
  /** A bougé depuis ma dernière visite (lot 9) : la carte s'allume, la date se souligne. */
  unseen?: boolean;
}

/** La pastille « ça attend une review » — la seule information colorée de la bande. */
function AwaitingBadge({ count }: { count: number }) {
  const t = useT();
  return (
    <span
      title={t('cards.awaitingReview', { count })}
      className="flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-2xs font-medium text-warning"
    >
      <Eye size={11} />
      {count}
    </span>
  );
}

/**
 * « Du nouveau ici » — le point qui accompagne la lueur de la carte.
 *
 * La lueur seule ne dit pas ce qu'elle veut dire, et une bordure colorée ne se voit pas
 * quand on regarde une carte de près. Le point porte l'infobulle qui l'explique, et donne
 * à la couleur un point d'ancrage nommé. Il vit à gauche de la date, parce que c'est la
 * date qui répond à « depuis quand ».
 */
function UnseenDot() {
  const t = useT();
  return (
    <span
      title={t('cards.unseen')}
      aria-label={t('cards.unseen')}
      // L'anneau fait la lueur : un point de six pixels ne se voit pas seul dans une bande
      // qui porte déjà des visages et une pastille.
      className="h-1.5 w-1.5 shrink-0 rounded-full bg-info ring-2 ring-info/30"
    />
  );
}

/** La description, sur deux lignes au plus — au-delà, ce n'est plus un aperçu. */
export function MetaDescription({ text }: { text: string }) {
  return <p className="line-clamp-2 text-2xs leading-snug text-muted-foreground">{text}</p>;
}

/**
 * La bande du bas d'une carte : visages à gauche, attente et date à droite.
 *
 * Elle ne s'affiche que si elle a quelque chose à dire — une bande vide sur une carte
 * neuve ajouterait une hauteur pour rien, et la grille perdrait sa densité.
 */
export default function EntityCardMeta({ meta, compact }: { meta: EntityMeta; compact?: boolean }) {
  const t = useT();
  const people = meta.assignees ?? [];
  const awaiting = meta.awaitingReview ?? 0;
  const departments = meta.departments ?? [];
  // Le point « non consulté » suffit à justifier la bande : une carte neuve dont rien
  // d'autre n'est renseigné doit tout de même pouvoir dire qu'elle est neuve.
  if (people.length === 0 && awaiting === 0 && !meta.updatedAt && departments.length === 0 && !meta.unseen)
    return null;

  return (
    <div className={`flex items-center gap-2 ${compact ? '' : 'mt-2'}`}>
      <AssigneeStack people={people} size={compact ? 20 : 22} max={compact ? 3 : 4} />
      {/* Les étapes en compact tiendraient rarement : la ligne EST la carte. */}
      {!compact && <DepartmentChips departments={departments} />}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {awaiting > 0 && <AwaitingBadge count={awaiting} />}
        {meta.unseen && <UnseenDot />}
        {meta.updatedAt && (
          <span
            title={t('cards.updatedAt', { value: new Date(meta.updatedAt).toLocaleString(intlLocale()) })}
            // La date passe en pleine couleur quand c'est du nouveau : c'est elle qu'on lit
            // pour savoir de quand date ce nouveau, autant qu'elle se voie.
            className={`text-2xs tabular-nums ${
              meta.unseen ? 'font-medium text-info' : 'text-muted-foreground'
            }`}
          >
            {timeAgo(meta.updatedAt)}
          </span>
        )}
      </span>
    </div>
  );
}
