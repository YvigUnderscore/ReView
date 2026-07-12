import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Clapperboard } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useProjectsQuery } from '../lib/queries';
import type { MediaKind } from '../types/api';
import Shell from '../components/Shell';
import ViewToggle from '../components/ViewToggle';
import { useViewMode } from '../stores/useViewPref';
import EntityCard, { EntityContainer } from '../components/EntityCard';
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
  const { data: projects } = useProjectsQuery();
  const [projectId, setProjectId] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');

  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (kind) params.set('kind', kind);
  if (status) params.set('status', status);
  const qs = params.toString();

  const { data, error } = useQuery({
    queryKey: qk.reviews(qs),
    queryFn: () => api.get<Page<ReviewItem>>(`/api/media/reviews${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData,
  });

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
                to={`/review/${m.id}`}
                view={view}
                title={m.name}
                subtitle={[m.project?.name, m.location].filter(Boolean).join(' · ') || undefined}
                thumbnailUrl={m.thumbnailUrl}
                badge={
                  m.published ? (
                    <Badge variant="info">{MEDIA_KIND_LABEL[m.kind]}</Badge>
                  ) : (
                    <Badge variant="warning">Brouillon</Badge>
                  )
                }
              />
            ))}
          </EntityContainer>
        </>
      )}
    </Shell>
  );
}
