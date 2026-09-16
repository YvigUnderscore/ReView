// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { memo } from 'react';
import { CheckCircle2, FolderOpen, ListVideo, Trash2 } from 'lucide-react';
import EntityCard from '../../components/EntityCard';
import ReviewDecisionBadge from '../../components/ReviewDecisionBadge';
import { Badge } from '../../components/ui/badge';
import { reviewPath } from '../../lib/slug';
import type { SelectModifiers } from '../../lib/useMultiSelect';
import type { ViewMode } from '../../stores/useViewPref';
import { mediaKindLabels, type ReviewItem } from './reviewsTypes';
import { useT } from '../../i18n';

/**
 * Une carte de la page Reviews — et la **frontière de mémoïsation** de cette page.
 *
 * La page en affiche cent d'un coup, chacune portant un menu contextuel Radix, une case
 * cochable et un aperçu animé. Tant que la grille était écrite en ligne dans la page,
 * cocher une seule case recréait les cent descripteurs de menu et re-rendait les cent
 * cartes. Ici, seules les props d'une carte changent quand son état de sélection change :
 * `memo` arrête la re-render aux quatre-vingt-dix-neuf autres.
 *
 * Le contrat tient à une condition, et c'est la page qui la tient : les rappels reçus
 * doivent être stables d'un rendu à l'autre (cf. `ReviewsPage`, qui lit la sélection au
 * moment du clic plutôt qu'au rendu).
 */
export interface ReviewCardProps {
  item: ReviewItem;
  view: ViewMode;
  selected: boolean;
  /** Droits qui ouvrent une entrée de menu supplémentaire. */
  canDecide: boolean;
  canPlaylist: boolean;
  onSelect: (id: number, mods?: SelectModifiers) => void;
  onOpen: (item: ReviewItem) => void;
  onDecide: (id: number) => void;
  onPlaylist: (id: number) => void;
  onDelete: (id: number) => void;
}

function ReviewCard({
  item,
  view,
  selected,
  canDecide,
  canPlaylist,
  onSelect,
  onOpen,
  onDecide,
  onPlaylist,
  onDelete,
}: ReviewCardProps) {
  const t = useT();
  const kindLabels = mediaKindLabels(t);

  return (
    <EntityCard
      to={reviewPath({ id: item.id, originalName: item.name })}
      view={view}
      title={item.name}
      subtitle={[item.project?.name, item.location].filter(Boolean).join(' · ') || undefined}
      thumbnailUrl={item.thumbnailUrl}
      hoverSprite={item.hoverSprite}
      selection={{ selected, onSelect: (mods) => onSelect(item.id, mods) }}
      contextActions={[
        {
          icon: <FolderOpen size={14} />,
          label: t('common.open'),
          onClick: () => onOpen(item),
        },
        // Le clic droit est la porte d'entrée des actions (UI simple) : la décision s'y
        // pose pour une carte comme pour toute la sélection.
        ...(canDecide
          ? [
              {
                icon: <CheckCircle2 size={14} />,
                label: t('decision.title'),
                onClick: () => onDecide(item.id),
              },
            ]
          : []),
        ...(canPlaylist
          ? [
              {
                icon: <ListVideo size={14} />,
                label: t('reviews.addToPlaylist'),
                onClick: () => onPlaylist(item.id),
              },
            ]
          : []),
        {
          icon: <Trash2 size={14} />,
          label: t('common.delete'),
          danger: true,
          onClick: () => onDelete(item.id),
        },
      ]}
      badge={
        <span className="flex items-center gap-1">
          {item.published ? (
            <Badge variant="info">{kindLabels[item.kind]}</Badge>
          ) : (
            <Badge variant="warning">{t('reviews.draft')}</Badge>
          )}
          {item.reviewStatus && <ReviewDecisionBadge status={item.reviewStatus} />}
        </span>
      }
    />
  );
}

export default memo(ReviewCard);
