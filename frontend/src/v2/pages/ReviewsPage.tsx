import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clapperboard, FolderOpen, ListVideo, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useProjectsQuery, useReviewStatusesQuery } from '../lib/queries';
import { reviewPath } from '../lib/slug';
import { useMultiSelect } from '../lib/useMultiSelect';
import { bulkDelete } from '../lib/bulkApi';
import type { MediaKind } from '../types/api';
import Shell from '../components/Shell';
import AddToPlaylistDialog from '../components/AddToPlaylistDialog';
import ViewToggle from '../components/ViewToggle';
import { useAuth } from '../stores/useAuth';
import { useViewMode } from '../stores/useViewPref';
import EntityCard, { EntityContainer } from '../components/EntityCard';
import ConfirmDialog from '../components/ConfirmDialog';
import ReviewDecisionBadge from '../components/ReviewDecisionBadge';
import SelectionBar from '../components/ui/selection-bar';
import { Badge } from '../components/ui/badge';
import { Select } from '../components/ui/select';
import { SkeletonCards } from '../components/ui/skeleton';
import EmptyState from '../components/ui/empty-state';
import { MEDIA_KIND_LABEL, type ReviewItem } from './reviews/reviewsTypes';

interface Page<T> {
  items: T[];
  total: number;
}

const KIND_OPTIONS: readonly MediaKind[] = ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'];

/**
 * Page « Reviews » globale (12.C) : tous les médias publiés de mes projets + mes
 * brouillons, filtrables par projet/type/statut, tri récent, vignettes → /review/:id.
 */
export default function ReviewsPage() {
  const view = useViewMode('reviews');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: projects } = useProjectsQuery();
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

  const { data, error } = useQuery({
    queryKey: qk.reviews(qs),
    queryFn: () => api.get<Page<ReviewItem>>(`/api/media/reviews${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData,
  });

  const sel = useMultiSelect(data?.items.map((m) => m.id) ?? []);
  const refresh = () => qc.invalidateQueries({ queryKey: ['reviews'] });
  const confirmBulkDelete = async () => {
    try {
      const { count } = await bulkDelete('media', sel.ids);
      toast.success(`${count} média(s) déplacé(s) dans la corbeille`);
      sel.clear();
      setBulkDeleting(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };
  // Projet commun des médias ciblés (une playlist = un projet) ; null si mixte.
  const targetProjectId = (() => {
    if (!playlistTarget || !data) return null;
    const ids = new Set(playlistTarget);
    const pids = new Set(data.items.filter((m) => ids.has(m.id)).map((m) => m.project?.id ?? 0));
    return pids.size === 1 ? ([...pids][0] ?? null) : null;
  })();

  const deleteOne = async (id: number) => {
    try {
      await bulkDelete('media', [id]);
      toast.success('Média déplacé dans la corbeille');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  return (
    <Shell title="Reviews">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Reviews</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="text-xs">
            <option value="">Tous les projets</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="text-xs">
            <option value="">Tous les types</option>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {MEDIA_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="text-xs">
            <option value="">Publiés + mes brouillons</option>
            <option value="published">Publiés</option>
            <option value="draft">Mes brouillons</option>
          </Select>
          <Select value={decision} onChange={(e) => setDecision(e.target.value)} className="text-xs">
            <option value="">Toutes décisions</option>
            <option value="none">Sans décision</option>
            {(reviewStatuses ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <ViewToggle contextKey="reviews" />
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error.message}</p>}

      {data === undefined ? (
        <SkeletonCards />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="Aucune review"
          description="Aucun média ne correspond à ces filtres. Publiez un média depuis une tâche pour lancer une review."
        />
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {data.total} média{data.total > 1 ? 's' : ''}
          </p>
          <EntityContainer view={view}>
            {data.items.map((m) => (
              <EntityCard
                key={m.id}
                to={reviewPath({ id: m.id, originalName: m.name })}
                view={view}
                title={m.name}
                subtitle={[m.project?.name, m.location].filter(Boolean).join(' · ') || undefined}
                thumbnailUrl={m.thumbnailUrl}
                selection={{ selected: sel.isSelected(m.id), onSelect: (mods) => sel.onSelect(m.id, mods) }}
                contextActions={[
                  {
                    icon: <FolderOpen size={14} />,
                    label: 'Ouvrir',
                    onClick: () => navigate(reviewPath({ id: m.id, originalName: m.name })),
                  },
                  ...(canPlaylist
                    ? [
                        {
                          icon: <ListVideo size={14} />,
                          label: 'Ajouter à la playlist…',
                          // Agit sur la sélection si la carte en fait partie, sinon sur la carte.
                          onClick: () =>
                            setPlaylistTarget(sel.count > 0 && sel.isSelected(m.id) ? sel.ids : [m.id]),
                        },
                      ]
                    : []),
                  {
                    icon: <Trash2 size={14} />,
                    label: 'Supprimer',
                    danger: true,
                    onClick: () => deleteOne(m.id),
                  },
                ]}
                badge={
                  <span className="flex items-center gap-1">
                    {m.published ? (
                      <Badge variant="info">{MEDIA_KIND_LABEL[m.kind]}</Badge>
                    ) : (
                      <Badge variant="warning">Brouillon</Badge>
                    )}
                    {m.reviewStatus && <ReviewDecisionBadge status={m.reviewStatus} />}
                  </span>
                }
              />
            ))}
          </EntityContainer>
        </>
      )}

      <SelectionBar
        count={sel.count}
        label="média(s)"
        onClear={sel.clear}
        actions={[
          ...(canPlaylist
            ? [
                {
                  label: 'Ajouter à la playlist…',
                  icon: <ListVideo size={14} />,
                  onClick: () => setPlaylistTarget(sel.ids),
                },
              ]
            : []),
          {
            label: 'Supprimer',
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
        title="Supprimer les médias ?"
        message={<>{sel.count} média(s) seront déplacés dans la corbeille.</>}
        confirmLabel="Mettre à la corbeille"
        danger
        onConfirm={confirmBulkDelete}
        onCancel={() => setBulkDeleting(false)}
      />
    </Shell>
  );
}
