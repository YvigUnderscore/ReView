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
 * One card of the Reviews page — and the **memoisation boundary** of this page.
 *
 * The page shows a hundred at once, each carrying a Radix context menu, a tick box and an
 * animated preview. While the grid was written inline in the page, ticking a single box rebuilt
 * the hundred menu descriptors and re-rendered the hundred cards. Here, only the props of one
 * card change when its selection state changes: `memo` stops the re-render of the other
 * ninety-nine.
 *
 * The contract holds under one condition, which the page enforces: the callbacks received must be
 * stable from one render to the next (see `ReviewsPage`, which reads the selection at click time
 * rather than at render time).
 */
export interface ReviewCardProps {
  item: ReviewItem;
  view: ViewMode;
  selected: boolean;
  /** Rights that open an extra menu entry. */
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
        // The right click is the entry point for actions (simple UI): the decision is set there
        // for a card as well as for the whole selection.
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
