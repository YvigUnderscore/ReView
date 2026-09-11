// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, FolderOpen } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { reviewPath } from '../../lib/slug';
import EntityCard, { EntityContainer } from '../../components/EntityCard';
import ReviewDecisionBadge from '../../components/ReviewDecisionBadge';
import { Badge } from '../../components/ui/badge';
import { mediaKindLabels, type ReviewItem } from './reviewsTypes';
import { useT } from '../../i18n';

/**
 * « Assigned to me » — les reviews qu'on m'a confiées (Phase 49).
 *
 * La page Reviews répondait à « qu'est-ce qui est sorti ? » ; elle ne répondait pas à
 * « qu'est-ce qu'on attend de moi ? ». Un artiste ouvrait mille cartes pour retrouver les
 * trois plans qu'un superviseur lui avait demandé de regarder à l'oral. L'encart est cette
 * réponse-là, en tête de page, avant les filtres qu'il faut penser à poser.
 *
 * Il disparaît quand il est vide : un cadre « rien pour vous » en permanence en haut de la
 * page coûterait à tout le monde le bénéfice qu'il apporte à ceux qui ont une file.
 *
 * Les cartes sont celles de la page, en vue compacte quel que soit le réglage d'affichage :
 * un encart de six grandes vignettes repousserait la liste elle-même hors de l'écran.
 */

/** Assez pour voir sa file d'un coup d'œil, trop peu pour cacher la page. */
const PREVIEW_SIZE = 6;

export default function AssignedToMeSection({ onSeeAll }: { onSeeAll: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const kindLabels = mediaKindLabels(t);
  const query = `assigned=me&pageSize=${PREVIEW_SIZE}`;
  // Même préfixe de clé que la liste (`['reviews', …]`) : les invalidations déjà écrites —
  // décision posée, média mis à la corbeille — rafraîchissent l'encart avec elle.
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
            {/* « Tout voir » existe déjà, traduit dans les quatorze langues : une
                quinzième formulation du même mot coûterait quatorze traductions. */}
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
