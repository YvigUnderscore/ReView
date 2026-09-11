// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Eye } from 'lucide-react';
import type { ReviewAssignee } from '../../types/entities';
import { useT } from '../../i18n';

/**
 * La consigne écrite POUR VOUS, en haut de la review.
 *
 * C'est tout l'objet de la fonctionnalité : la notification dit qu'on vous attend, cette
 * bande dit sur quoi — au moment exact où vous regardez le média, et non trois clics plus
 * loin dans un dialogue qu'il faudrait penser à ouvrir.
 *
 * Elle ne s'affiche qu'à la personne confiée, et seulement si une consigne a été écrite :
 * une assignation sans consigne n'a rien à annoncer, et une bande vide ne ferait que voler
 * de la hauteur au viewer.
 */
export default function ReviewBriefBanner({
  reviewers,
  currentUserId,
}: {
  reviewers: ReviewAssignee[];
  currentUserId: number | undefined;
}) {
  const t = useT();
  const mine = reviewers.find((person) => person.id === currentUserId);
  if (!mine?.note) return null;

  return (
    <div className="mb-2 flex shrink-0 items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
      <Eye size={15} className="mt-0.5 shrink-0 text-primary" />
      <p className="min-w-0 text-sm">
        <span className="mr-1.5 text-2xs section-label text-muted-foreground">{t('reviewers.forYou')}</span>
        {/* `whitespace-pre-wrap` : la consigne est écrite dans un champ multi-ligne, et une
            liste de trois points revenue sur une seule ligne se relit mal. */}
        <span className="whitespace-pre-wrap">{mine.note}</span>
      </p>
    </div>
  );
}
