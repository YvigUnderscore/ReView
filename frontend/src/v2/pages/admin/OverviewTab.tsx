// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import { DistList, Metric, Panel, ServiceHealth } from './AdminPrimitives';
import { fmtBytes, type Stats, type System } from './adminShared';

export default function OverviewTab() {
  const statsQ = useQuery({ queryKey: qk.admin('stats'), queryFn: () => api.get<Stats>('/api/admin/stats') });
  const systemQ = useQuery({
    queryKey: qk.admin('system'),
    queryFn: () => api.get<System>('/api/admin/system'),
  });
  const stats = statsQ.data ?? null;
  const system = systemQ.data ?? null;

  const retryJobs = async () => {
    try {
      const { retried } = await api.post<{ retried: number }>('/api/admin/jobs/retry');
      toast.success(`${retried} job(s) relancé(s).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Relance impossible');
    }
  };

  if (!stats) return <SkeletonRows count={4} />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Metric
          label="Utilisateurs"
          value={stats.users.total}
          sub={`${stats.users.online} en ligne`}
          to="/admin/users"
        />
        <Metric label="Projets" value={stats.pipeline.projects} to="/admin/projects" />
        <Metric label="Séquences" value={stats.pipeline.sequences} to="/admin/projects" />
        <Metric label="Shots" value={stats.pipeline.shots} to="/admin/projects" />
        <Metric label="Assets" value={stats.pipeline.assets} to="/admin/projects" />
        <Metric label="Versions" value={stats.pipeline.versions} to="/admin/versions" />
        <Metric label="Médias" value={stats.media.count} to="/reviews" />
        <Metric label="Commentaires" value={stats.comments} to="/admin/comments" />
        <Metric label="Stockage" value={fmtBytes(stats.media.storageBytes)} to="/admin/storage" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Médias par type">
          <DistList data={stats.media.byKind} />
        </Panel>
        <Panel title="Médias par statut">
          <DistList data={stats.media.byStatus} />
        </Panel>
        <Panel title="Files de jobs (FFmpeg)">
          {stats.jobs ? (
            <>
              <DistList data={stats.jobs} />
              {(stats.jobs.failed ?? 0) > 0 && (
                <Button variant="outline" size="sm" className="mt-2" onClick={retryJobs}>
                  <RefreshCw size={13} /> Relancer les jobs en échec
                </Button>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">File indisponible.</p>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top stockage / utilisateur">
          <div className="space-y-1.5">
            {stats.topStorageUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between text-sm">
                <Link to={`/admin/users/${u.id}`} className="truncate hover:underline">
                  {u.name}
                </Link>
                <span className="text-muted-foreground">
                  {fmtBytes(u.storageUsed)}
                  {u.storageLimit ? ` / ${fmtBytes(u.storageLimit)}` : ''}
                </span>
              </div>
            ))}
            {stats.topStorageUsers.length === 0 && (
              <p className="text-xs text-muted-foreground">Aucune donnée.</p>
            )}
          </div>
        </Panel>
        <Panel title="Santé des services">
          {system ? <ServiceHealth services={system.services} /> : <SkeletonRows count={2} />}
        </Panel>
      </div>
    </div>
  );
}
