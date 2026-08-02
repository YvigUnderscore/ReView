// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { SkeletonRows } from '../../components/ui/skeleton';
import { fmtBytes } from './adminShared';
import { filterProjects, PROJECT_STATUS_LABELS, quotaPct } from './adminProjects';
import type { AdminProjectRow, ProjectStatus } from '../../types/api';

/** Liste d'administration des projets : compteurs pipeline, stockage/quota, fiches. */
export default function ProjectsAdminTab() {
  const { data, isLoading } = useQuery({
    queryKey: qk.adminProjects,
    queryFn: () => api.get<{ projects: AdminProjectRow[] }>('/api/admin/projects'),
  });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ProjectStatus | 'ALL'>('ALL');

  if (isLoading || !data) return <SkeletonRows count={5} />;
  const shown = filterProjects(data.projects, q, status);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher (nom, slug)…"
            className="pl-8"
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus | 'ALL')}>
          <option value="ALL">Tous les statuts</option>
          {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        {shown.length} projet(s) — la fiche détaille membres, hiérarchie et réglages hérités. Les projets
        supprimés sont dans Maintenance › Corbeille.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Projet</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2 text-right">Membres</th>
              <th className="px-3 py-2 text-right">Séq.</th>
              <th className="px-3 py-2 text-right">Shots</th>
              <th className="px-3 py-2 text-right">Assets</th>
              <th className="px-3 py-2 text-right">Versions</th>
              <th className="px-3 py-2 text-right">Médias</th>
              <th className="px-3 py-2">Stockage</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const pct = quotaPct(p.usage, p.quota);
              return (
                <tr key={p.id} className="border-t border-border hover:bg-secondary/40">
                  <td className="px-3 py-2">
                    <Link to={`/admin/projects/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">{p.slug}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary">{PROJECT_STATUS_LABELS[p.status]}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{p.counts.memberships}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{p.counts.sequences}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{p.counts.shots}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{p.counts.assets}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{p.counts.versions}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{p.counts.media}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {fmtBytes(p.usage)}
                    {p.quota != null && pct != null && (
                      <span className={pct >= 90 ? 'text-destructive' : ''}>
                        {' '}
                        / {fmtBytes(p.quota)} ({pct}%)
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Aucun projet ne correspond aux filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
