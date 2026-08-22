// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Clapperboard, FolderOpen, ListVideo, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { qk } from '../lib/query';
import { useProjectsQuery, useReviewStatusesQuery } from '../lib/queries';
import { useInfiniteList } from '../lib/useInfiniteList';
import { reviewPath } from '../lib/slug';
import { useMultiSelect } from '../lib/useMultiSelect';
import { bulkDelete } from '../lib/bulkApi';
import type { MediaKind } from '../types/api';
import PageShell from '../components/PageShell';
import AddToPlaylistDialog from '../components/AddToPlaylistDialog';
import SavedViewsMenu from '../components/SavedViewsMenu';
import ViewToggle from '../components/ViewToggle';
import { useAuth } from '../stores/useAuth';
import { useViewMode } from '../stores/useViewPref';
import EntityCard, { EntityContainer } from '../components/EntityCard';
import ListSentinel, { ListCount } from '../components/ListSentinel';
import ConfirmDialog from '../components/ConfirmDialog';
import ReviewDecisionBadge from '../components/ReviewDecisionBadge';
import SelectionBar from '../components/ui/selection-bar';
import { Badge } from '../components/ui/badge';
import { Select } from '../components/ui/select';
import { SkeletonCards } from '../components/ui/skeleton';
import EmptyState from '../components/ui/empty-state';
import { mediaKindLabels, type ReviewItem } from './reviews/reviewsTypes';
import { useT } from '../i18n';

const KIND_OPTIONS: readonly MediaKind[] = ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'];

/**
 * Page « Reviews » globale (12.C) : tous les médias publiés de mes projets + mes
 * brouillons, filtrables par projet/type/statut, tri récent, vignettes → /review/:id.
 */
export default function ReviewsPage() {
  const t = useT();
  const kindLabels = mediaKindLabels(t);
  const view = useViewMode('reviews');
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Le filtre doit proposer tous les projets, pas les cent premiers : une liste déroulante
  // ne défile pas jusqu'à une sentinelle.
  const { data: projects } = useProjectsQuery({ all: true });
  const { data: reviewStatuses } = useReviewStatusesQuery();
  const [projectId, setProjectId] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [decision, setDecision] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // « Ajouter à la playlist » (Phase 33) : mediaIds ciblés (carte seule ou sélection).
  const [playlistTarget, setPlaylistTarget] = useState<number[] | null>(null);
  const role = useAuth((s) => s.user?.role);
  const canPlaylist = role === 'ADMIN' || role === 'SUPERVISOR' || role === 'ARTIST';

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (kind) params.set('kind', kind);
  if (status) params.set('status', status);
  if (decision) params.set('decision', decision);
  const qs = params.toString();

  // La page annonçait fièrement « 1 247 media » au-dessus de cent cartes : le total venait
  // du serveur, les cartes d'une seule page. Les deux se rejoignent enfin.
  const list = useInfiniteList<ReviewItem>(qk.reviews(qs), `/api/media/reviews${qs ? `?${qs}` : ''}`, {
    keepPrevious: true,
  });
  const { data: items, error } = list;

  const sel = useMultiSelect(items?.map((m) => m.id) ?? []);
  const refresh = () => qc.invalidateQueries({ queryKey: ['reviews'] });
  const confirmBulkDelete = async () => {
    try {
      const { count } = await bulkDelete('media', sel.ids);
      toast.success(t('reviews.trashed', { count }));
      sel.clear();
      setBulkDeleting(false);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };
  // Projet commun des médias ciblés (une playlist = un projet) ; null si mixte.
  const targetProjectId = (() => {
    if (!playlistTarget || !items) return null;
    const ids = new Set(playlistTarget);
    const pids = new Set(items.filter((m) => ids.has(m.id)).map((m) => m.project?.id ?? 0));
    return pids.size === 1 ? ([...pids][0] ?? null) : null;
  })();

  const deleteOne = async (id: number) => {
    try {
      await bulkDelete('media', [id]);
      toast.success(t('reviews.trashed'));
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  return (
    <PageShell title={t('nav.reviews')}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('nav.reviews')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="text-xs">
            <option value="">{t('reviews.filter.allProjects')}</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="text-xs">
            <option value="">{t('reviews.filter.allTypes')}</option>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {kindLabels[k]}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="text-xs">
            <option value="">{t('reviews.filter.publishedAndDrafts')}</option>
            <option value="published">{t('reviews.filter.published')}</option>
            <option value="draft">{t('reviews.filter.myDrafts')}</option>
          </Select>
          <Select value={decision} onChange={(e) => setDecision(e.target.value)} className="text-xs">
            <option value="">{t('reviews.filter.allDecisions')}</option>
            <option value="none">{t('reviews.filter.noDecision')}</option>
            {(reviewStatuses ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <SavedViewsMenu
            scope="reviews"
            current={{ projectId, kind, status, decision }}
            onApply={(f) => {
              setProjectId(f.projectId ?? '');
              setKind(f.kind ?? '');
              setStatus(f.status ?? '');
              setDecision(f.decision ?? '');
            }}
          />
          <ViewToggle contextKey="reviews" />
        </div>
      </div>

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
              <EntityCard
                key={m.id}
                to={reviewPath({ id: m.id, originalName: m.name })}
                view={view}
                title={m.name}
                subtitle={[m.project?.name, m.location].filter(Boolean).join(' · ') || undefined}
                thumbnailUrl={m.thumbnailUrl}
                hoverSprite={m.hoverSprite}
                selection={{ selected: sel.isSelected(m.id), onSelect: (mods) => sel.onSelect(m.id, mods) }}
                contextActions={[
                  {
                    icon: <FolderOpen size={14} />,
                    label: t('common.open'),
                    onClick: () => void navigate(reviewPath({ id: m.id, originalName: m.name })),
                  },
                  ...(canPlaylist
                    ? [
                        {
                          icon: <ListVideo size={14} />,
                          label: t('reviews.addToPlaylist'),
                          // Agit sur la sélection si la carte en fait partie, sinon sur la carte.
                          onClick: () =>
                            setPlaylistTarget(sel.count > 0 && sel.isSelected(m.id) ? sel.ids : [m.id]),
                        },
                      ]
                    : []),
                  {
                    icon: <Trash2 size={14} />,
                    label: t('common.delete'),
                    danger: true,
                    onClick: () => void deleteOne(m.id),
                  },
                ]}
                badge={
                  <span className="flex items-center gap-1">
                    {m.published ? (
                      <Badge variant="info">{kindLabels[m.kind]}</Badge>
                    ) : (
                      <Badge variant="warning">{t('reviews.draft')}</Badge>
                    )}
                    {m.reviewStatus && <ReviewDecisionBadge status={m.reviewStatus} />}
                  </span>
                }
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
        projectId={targetProjectId}
        mediaIds={playlistTarget ?? []}
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
