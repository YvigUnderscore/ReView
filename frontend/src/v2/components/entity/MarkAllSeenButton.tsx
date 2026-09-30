// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCheck } from 'lucide-react';
import { Button } from '../ui/button';
import { useMarkAllSeen, type VisitListTarget } from '../../lib/useVisits';
import { useT } from '../../i18n';

/**
 * « Tout marquer comme lu » — le bouton qui éteint une liste entière.
 *
 * L'interface se veut sobre et fait passer toute action par le clic droit ; celle-ci est
 * l'exception assumée, parce qu'elle ne porte sur aucune carte en particulier : il n'existe
 * pas de carte sur laquelle faire ce clic droit. Elle reste invisible tant qu'il n'y a rien
 * à éteindre, et ne pèse donc que sur les écrans qui ont effectivement du nouveau.
 *
 * Le compte affiché est celui de la liste chargée. Le geste, lui, porte sur tout le projet :
 * ce qui reste à descendre s'éteint aussi, sinon « tout » serait un mensonge.
 */
export default function MarkAllSeenButton({
  target,
  projectId,
  unseenCount,
}: {
  target: VisitListTarget;
  projectId: number;
  unseenCount: number;
}) {
  const t = useT();
  const mark = useMarkAllSeen(target, projectId);
  if (unseenCount === 0) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={mark.isPending}
      onClick={() => mark.mutate()}
      // Le compte vit dans l'infobulle, pas dans le libellé : un bouton dont le texte
      // change de longueur à chaque rafraîchissement fait sauter la barre d'outils.
      title={t('cards.markAllSeenHint', { count: unseenCount })}
    >
      <CheckCheck size={14} />
      {t('cards.markAllSeen')}
    </Button>
  );
}
