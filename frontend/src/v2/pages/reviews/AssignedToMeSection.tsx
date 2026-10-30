// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, FolderOpen } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import { reviewPath } from '../../lib/slug';
import EntityCard, { EntityContainer } from '../../components/EntityCard';
import ReviewDecisionBadge from '../../components/ReviewDecisionBadge';
import { Badge } from '../../components/ui/badge';
import { mediaKindLabels, type ReviewItem } from './reviewsTypes';
import { useT } from '../../i18n';

/**
 * "Assigned to me" — the reviews assigned to me (Phase 49).
 *
 * The Reviews page answered "what has been published?"; it did not answer "what is expected of
 * me?". An artist would open a thousand cards to find the three shots a supervisor had asked
 * them to look at out loud. The panel is that answer, at the top of the page, before the filters
 * one has to remember to set.
 *
 * It disappears when empty: a permanent "nothing for you" frame at the top of the page would cost
 * everyone the benefit it brings to those who do have a queue.
 *
 * The cards are the page's own, in compact view whatever the display setting: a panel of six
 * large thumbnails would push the list itself off the screen.
 */

/** Enough to see one's queue at a glance, too few to hide the page. */
const PREVIEW_SIZE = 6;

export default function AssignedToMeSection({ onSeeAll }: { onSeeAll: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const kindLabels = mediaKindLabels(t);
  const query = `assigned=me&pageSize=${PREVIEW_SIZE}`;
  // Same key prefix as the list (`['reviews', …]`): the invalidations already written — decision
  // set, media moved to the trash — refresh the panel along with it.
  const { data } = useQuery({
    queryKey: qk.reviews(query),
    queryFn: () => api.get<{ items: ReviewItem[]; total: number }>(`/api/media/reviews?${query}`),
  });

  const items = data?.items ?? [];
  if (items.length === 0) return null;
  const total = data?.total ?? items.length;

  return (
    <section
      aria-label={t('reviews.assigned.title')}
      className="mb-6 rounded-lg border border-border bg-card p-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ClipboardCheck size={16} className="text-primary" />
        <h2 className="text-sm font-semibold">{t('reviews.assigned.title')}</h2>
        <Badge variant="info">{t('reviews.assigned.count', { count: total })}</Badge>
        {total > items.length && (
          <button
            type="button"
            onClick={onSeeAll}
            className="ml-auto rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {/* "See all" already exists, translated into all fourteen languages: a fifteenth
                wording of the same word would cost fourteen translations. */}
            {t('refs.seeAll')}
          </button>
        )}
      </div>

      <EntityContainer view="compact">
        {items.map((m) => (
          <EntityCard
            key={m.id}
            to={reviewPath({ id: m.id, originalName: m.name })}
            view="compact"
            title={m.name}
            subtitle={[m.project?.name, m.location].filter(Boolean).join(' · ') || undefined}
            thumbnailUrl={m.thumbnailUrl}
            contextActions={[
              {
                icon: <FolderOpen size={14} />,
                label: t('common.open'),
                onClick: () => void navigate(reviewPath({ id: m.id, originalName: m.name })),
              },
            ]}
            badge={
              <span className="flex items-center gap-1">
                <Badge variant="info">{kindLabels[m.kind]}</Badge>
                {m.reviewStatus && <ReviewDecisionBadge status={m.reviewStatus} />}
              </span>
            }
          />
        ))}
      </EntityContainer>
    </section>
  );
}
