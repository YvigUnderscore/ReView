// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Bell, BellOff, ExternalLink } from 'lucide-react';
import { EditIcon, DeleteIcon } from '../../components/EntityCard';
import type { EntityItemAction } from '../../lib/menuSpec';
import type { t } from '../../i18n';

/**
 * Actions d'une carte de plan — barre au survol et menu contextuel.
 *
 * Pendant exact de `assetCardActions`, extrait pour la même raison : ce sont des données,
 * pas du rendu, et l'onglet dépassait son budget de lignes une fois la multi-sélection
 * posée. Les deux onglets décrivent désormais leurs gestes au même endroit et de la même
 * façon — c'est la condition pour qu'ils cessent de diverger.
 */
export function shotCardActions(input: {
  t: typeof t;
  canManage: boolean;
  /** Fiche ShotGrid, présente uniquement si le projet y est relié. */
  sgUrl: string | null | undefined;
  watching: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onWatch: () => void;
}): { manageActions: EntityItemAction[]; contextActions: EntityItemAction[] } {
  const { t, canManage, sgUrl, watching } = input;

  const manageActions: EntityItemAction[] = canManage
    ? [
        { icon: EditIcon, label: t('common.edit'), onClick: input.onEdit },
        { icon: DeleteIcon, label: t('common.delete'), danger: true, onClick: input.onDelete },
      ]
    : [];

  const contextActions: EntityItemAction[] = [
    ...(sgUrl
      ? [
          {
            icon: <ExternalLink size={14} />,
            label: t('shotgrid.openIn.shot'),
            onClick: () => window.open(sgUrl, '_blank', 'noreferrer'),
          },
        ]
      : []),
    // Suivi (32.G) : notifications sur l'activité du plan.
    {
      icon: watching ? <BellOff size={14} /> : <Bell size={14} />,
      label: watching ? t('shots.unwatch') : t('shots.watch'),
      onClick: input.onWatch,
    },
    ...manageActions,
  ];

  return { manageActions, contextActions };
}
