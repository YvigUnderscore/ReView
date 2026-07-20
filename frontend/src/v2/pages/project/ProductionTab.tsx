import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { ProjectStats } from '../../types/api';
import ReviewStatsPanel from '../../components/production/ReviewStatsPanel';

/** Onglet « Production » de la page projet (Phase 43) — statistiques de review (43.A). */
export default function ProductionTab({ projectId }: { projectId: number }) {
  const { data, error, isLoading } = useQuery({
    queryKey: qk.projectStats(projectId),
    queryFn: () => api.get<ProjectStats>(`/api/projects/${projectId}/stats`),
  });

  if (error) return <p className="mt-6 text-sm text-destructive">{error.message}</p>;
  if (isLoading || !data)
    return <p className="mt-6 text-sm text-muted-foreground">Chargement des statistiques…</p>;

  return (
    <div className="mt-6">
      <ReviewStatsPanel stats={data} projectId={projectId} />
    </div>
  );
}
