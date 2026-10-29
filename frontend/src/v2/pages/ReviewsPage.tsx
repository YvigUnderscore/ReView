// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { type ReviewItem, type ReviewsFilterState } from './reviews/reviewsTypes';
import { apiQuery, filtersFromSearch, searchWithFilters } from './reviews/reviewsUrl';
import ReviewCard from './reviews/ReviewCard';
import ReviewsFilters from './reviews/ReviewsFilters';
import BulkDecisionDialog from './reviews/BulkDecisionDialog';
import AssignedToMeSection from './reviews/AssignedToMeSection';
import { useT } from '../i18n';

/**
 * Global "Reviews" page (12.C): all published media from my projects plus my
 * drafts, filterable by project/type/status, recent sort, thumbnails → /review/:id.
 *
 * Filters live in the URL (`reviews/reviewsUrl`) rather than in local state: this is
 * what lets a home-page counter open ITS view, a search be shared, and the browser's
 * back button undo the last filter instead of leaving the page.
 */
export default function ReviewsPage() {
  const t = useT();
  const view = useViewMode('reviews');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useSearchParams();
  // The URL is the only source: nothing to synchronise, so nothing that can diverge. Each
  // change pushes a history entry — that is what back-navigation undoes.
  const filters = useMemo(() => filtersFromSearch(search), [search]);
  const setFilters = useCallback(
    (next: ReviewsFilterState) => setSearch(searchWithFilters(search, next)),
    [search, setSearch],
  );
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // "Add to playlist" (Phase 33): targeted mediaIds (card only or selection).
  const [playlistTarget, setPlaylistTarget] = useState<number[] | null>(null);
  // Batch review decision: targeted mediaIds, converted to versions on submit.
  const [decisionTarget, setDecisionTarget] = useState<number[] | null>(null);
  const role = useAuth((s) => s.user?.role);
  const canPlaylist = role === 'ADMIN' || role === 'SUPERVISOR' || role === 'ARTIST';
  const canDecide = role === 'ADMIN' || role === 'SUPERVISOR';

  const qs = apiQuery(filters);

  // The page proudly announced "1,247 media" above a hundred cards: the total came from
  // the server, the cards from a single page. The two finally agree.
  const list = useInfiniteList<ReviewItem>(qk.reviews(qs), `/api/media/reviews${qs ? `?${qs}` : ''}`, {
    keepPrevious: true,
  });
  const { data: items, error } = list;

  const sel = useMultiSelect(items?.map((m) => m.id) ?? []);
  // The selection is read **at click time**, not at render. Without this ref, each
  // ticked box would recreate the callbacks passed to the cards, and the hundred
  // memoised `ReviewCard`s would re-render anyway — memoisation only holds with
  // stable callbacks (written in an effect: a ref is not written during render).
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
  /** The targeted media, found in the current page (order does not matter). */
  const targeted = (mediaIds: number[] | null) => {
    if (!mediaIds || !items) return [];
    const wanted = new Set(mediaIds);
    return items.filter((m) => wanted.has(m.id));
  };
  /** Common project of the targeted media (a playlist = one project); null if mixed. */
  const commonProjectId = (mediaIds: number[] | null) => {
    const pids = new Set(targeted(mediaIds).map((m) => m.project?.id ?? 0));
    return pids.size === 1 ? ([...pids][0] ?? null) : null;
  };
  // Two media of the same version are worth only one decision: the decision bears on the
  // version, posting it twice would write two history lines for a single gesture.
  const targetVersionIds = [...new Set(targeted(decisionTarget).map((m) => m.versionId))];
  // Acts on the selection if the card is part of it, otherwise on the card alone.
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

      {/* The personal queue comes before the catalogue — and disappears when the whole list
          is already filtered on it, where it would say nothing more. */}
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
