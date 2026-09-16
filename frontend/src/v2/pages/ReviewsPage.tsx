// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clapperboard, ListVideo, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { qk } from '../lib/query';
import { useInfiniteList } from '../lib/useInfiniteList';
import { reviewPath } from '../lib/slug';
import { useMultiSelect } from '../lib/useMultiSelect';
import { bulkDelete } from '../lib/bulkApi';
import PageShell from '../components/PageShell';
import AddToPlaylistDialog from '../components/AddToPlaylistDialog';
import { useAuth } from '../stores/useAuth';
import { useViewMode } from '../stores/useViewPref';
import { EntityContainer } from '../components/EntityCard';
import ListSentinel, { ListCount } from '../components/ListSentinel';
import ConfirmDialog from '../components/ConfirmDialog';
import SelectionBar from '../components/ui/selection-bar';
import { SkeletonCards } from '../components/ui/skeleton';
import EmptyState from '../components/ui/empty-state';
import { EMPTY_FILTERS, type ReviewItem, type ReviewsFilterState } from './reviews/reviewsTypes';
import ReviewCard from './reviews/ReviewCard';
import ReviewsFilters from './reviews/ReviewsFilters';
import BulkDecisionDialog from './reviews/BulkDecisionDialog';
import AssignedToMeSection from './reviews/AssignedToMeSection';
import { useT } from '../i18n';

/**
 * Page « Reviews » globale (12.C) : tous les médias publiés de mes projets + mes
 * brouillons, filtrables par projet/type/statut, tri récent, vignettes → /review/:id.
 */
export default function ReviewsPage() {
  const t = useT();
  const view = useViewMode('reviews');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ReviewsFilterState>(EMPTY_FILTERS);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // « Ajouter à la playlist » (Phase 33) : mediaIds ciblés (carte seule ou sélection).
  const [playlistTarget, setPlaylistTarget] = useState<number[] | null>(null);
  // Décision de review en lot : mediaIds ciblés, convertis en versions à l'envoi.
  const [decisionTarget, setDecisionTarget] = useState<number[] | null>(null);
  const role = useAuth((s) => s.user?.role);
  const canPlaylist = role === 'ADMIN' || role === 'SUPERVISOR' || role === 'ARTIST';
  const canDecide = role === 'ADMIN' || role === 'SUPERVISOR';

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const qs = params.toString();

  // La page annonçait fièrement « 1 247 media » au-dessus de cent cartes : le total venait
  // du serveur, les cartes d'une seule page. Les deux se rejoignent enfin.
  const list = useInfiniteList<ReviewItem>(qk.reviews(qs), `/api/media/reviews${qs ? `?${qs}` : ''}`, {
    keepPrevious: true,
  });
  const { data: items, error } = list;

  const sel = useMultiSelect(items?.map((m) => m.id) ?? []);
  // La sélection est lue **au moment du clic**, pas au rendu. Sans cette ref, chaque
  // case cochée recréerait les rappels passés aux cartes, et les cent `ReviewCard`
  // mémoïsées se re-rendraient quand même — la mémoïsation ne tient que par des rappels
  // stables (écriture en effet : une ref ne s'écrit pas pendant le rendu).
  const selRef = useRef(sel);
  useEffect(() => {
    selRef.current = sel;
  });
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['reviews'] });
  }, [qc]);
  const confirmBulkDelete = async () => {
    try {
      const { count } = await bulkDelete('media', sel.ids);
      toast.success(t('reviews.trashed', { count }));
      sel.clear();
      setBulkDeleting(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };
  /** Les médias ciblés, retrouvés dans la page courante (l'ordre n'importe pas). */
  const targeted = (mediaIds: number[] | null) => {
    if (!mediaIds || !items) return [];
    const wanted = new Set(mediaIds);
    return items.filter((m) => wanted.has(m.id));
  };
  /** Projet commun des médias ciblés (une playlist = un projet) ; null si mixte. */
  const commonProjectId = (mediaIds: number[] | null) => {
    const pids = new Set(targeted(mediaIds).map((m) => m.project?.id ?? 0));
    return pids.size === 1 ? ([...pids][0] ?? null) : null;
  };
  // Deux médias d'une même version ne valent qu'une décision : la décision porte sur la
  // version, la poser deux fois écrirait deux lignes d'historique pour un seul geste.
  const targetVersionIds = [...new Set(targeted(decisionTarget).map((m) => m.versionId))];
  // Agit sur la sélection si la carte en fait partie, sinon sur la carte seule.
  const scopeOf = useCallback((id: number) => {
    const current = selRef.current;
    return current.count > 0 && current.isSelected(id) ? current.ids : [id];
  }, []);

  const deleteOne = useCallback(
    (id: number) => {
      void (async () => {
        try {
          await bulkDelete('media', [id]);
          toast.success(t('reviews.trashed'));
          refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t('common.error.generic'));
        }
      })();
    },
    [refresh, t],
  );
  const openReview = useCallback(
    (m: ReviewItem) => void navigate(reviewPath({ id: m.id, originalName: m.name })),
    [navigate],
  );
  const openDecision = useCallback((id: number) => setDecisionTarget(scopeOf(id)), [scopeOf]);
  const openPlaylist = useCallback((id: number) => setPlaylistTarget(scopeOf(id)), [scopeOf]);

  return (
    <PageShell title={t('nav.reviews')}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('nav.reviews')}</h1>
        <ReviewsFilters value={filters} onChange={setFilters} />
      </div>

      {/* La file personnelle passe avant le catalogue — et s'efface quand la liste entière
          est déjà filtrée sur elle, où elle ne dirait rien de plus. */}
      {!filters.assigned && (
        <AssignedToMeSection onSeeAll={() => setFilters({ ...filters, assigned: 'me' })} />
      )}

      {error && <p className="mb-4 text-sm text-destructive">{error.message}</p>}

      {items === undefined ? (
        <SkeletonCards />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title={t('reviews.empty.title')}
          description={t('reviews.empty.description')}
        />
      ) : (
        <>
          <ListCount
            loaded={list.loaded}
            total={list.total}
            label={t('reviews.count', { count: list.total })}
          />
          <EntityContainer view={view}>
            {items.map((m) => (
              <ReviewCard
                key={m.id}
                item={m}
                view={view}
                selected={sel.isSelected(m.id)}
                canDecide={canDecide}
                canPlaylist={canPlaylist}
                onSelect={sel.onSelect}
                onOpen={openReview}
                onDecide={openDecision}
                onPlaylist={openPlaylist}
                onDelete={deleteOne}
              />
            ))}
          </EntityContainer>
          <ListSentinel hasMore={list.hasMore} isLoading={list.isFetchingMore} onLoadMore={list.loadMore} />
        </>
      )}

      <SelectionBar
        count={sel.count}
        label={t('reviews.countLabel', { count: sel.count })}
        onClear={sel.clear}
        actions={[
          ...(canDecide
            ? [
                {
                  label: t('decision.title'),
                  icon: <CheckCircle2 size={14} />,
                  onClick: () => setDecisionTarget(sel.ids),
                },
              ]
            : []),
          ...(canPlaylist
            ? [
                {
                  label: t('reviews.addToPlaylist'),
                  icon: <ListVideo size={14} />,
                  onClick: () => setPlaylistTarget(sel.ids),
                },
              ]
            : []),
          {
            label: t('common.delete'),
            icon: <Trash2 size={14} />,
            danger: true,
            onClick: () => setBulkDeleting(true),
          },
        ]}
      />

      <AddToPlaylistDialog
        open={playlistTarget !== null}
        onOpenChange={(o) => !o && setPlaylistTarget(null)}
        projectId={commonProjectId(playlistTarget)}
        mediaIds={playlistTarget ?? []}
        onDone={sel.clear}
      />

      <BulkDecisionDialog
        open={decisionTarget !== null}
        onOpenChange={(o) => !o && setDecisionTarget(null)}
        projectId={commonProjectId(decisionTarget)}
        versionIds={targetVersionIds}
        onDone={sel.clear}
      />

      <ConfirmDialog
        open={bulkDeleting}
        title={t('reviews.deleteMany.title')}
        message={t('reviews.deleteMany.message', { count: sel.count })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={confirmBulkDelete}
        onCancel={() => setBulkDeleting(false)}
      />
    </PageShell>
  );
}
