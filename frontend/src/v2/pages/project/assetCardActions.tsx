// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Bell, BellOff, ExternalLink, FolderOpen, Link2 } from 'lucide-react';
import { EditIcon, DeleteIcon } from '../../components/EntityCard';
import type { EntityItemAction } from '../../lib/menuSpec';
import type { t } from '../../i18n';
import type { AssetListItem } from '../../types/entities';

/**
 * Actions d'une carte d'asset — barre au survol et menu contextuel.
 *
 * Extraites de l'onglet, qui dépassait son budget de lignes : ce sont des données, pas
 * du rendu, et les décrire ici les rend lisibles d'un seul tenant.
 */
export function assetCardActions(input: {
  asset: AssetListItem;
  t: typeof t;
  canManage: boolean;
  /** Fiche ShotGrid, présente uniquement si le projet y est relié. */
  sgUrl: string | null | undefined;
  watching: boolean;
  onEdit: () => void;
  onLink: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onWatch: () => void;
}): { manageActions: EntityItemAction[]; contextActions: EntityItemAction[] } {
  const { t, canManage, sgUrl, watching } = input;

  const manageActions: EntityItemAction[] = canManage
    ? [
        { icon: EditIcon, label: t('entity.settings.open'), onClick: input.onEdit },
        { icon: <Link2 size={15} />, label: t('assets.assign'), onClick: input.onLink },
        { icon: DeleteIcon, label: t('common.delete'), danger: true, onClick: input.onDelete },
      ]
    : [];

  const contextActions: EntityItemAction[] = [
    ...(sgUrl
      ? [
          {
            icon: <ExternalLink size={14} />,
            label: t('shotgrid.openIn.asset'),
            onClick: () => window.open(sgUrl, '_blank', 'noreferrer'),
          },
        ]
      : []),
    { icon: <FolderOpen size={14} />, label: t('common.open'), onClick: input.onOpen },
    // Suivi (32.G) : notifications sur l'activité de l'asset.
    {
      icon: watching ? <BellOff size={14} /> : <Bell size={14} />,
      label: watching ? t('assets.unwatch') : t('assets.watch'),
      onClick: input.onWatch,
    },
    ...manageActions,
  ];

  return { manageActions, contextActions };
}
