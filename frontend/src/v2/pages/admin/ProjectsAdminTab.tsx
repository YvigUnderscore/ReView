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
import { filterProjects, PROJECT_STATUSES, projectStatusLabels, quotaPct } from './adminProjects';
import type { AdminProjectRow, ProjectStatus } from '../../types/api';
import { useT } from '../../i18n';

/** Liste d'administration des projets : compteurs pipeline, stockage/quota, fiches. */
export default function ProjectsAdminTab() {
  const t = useT();
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
            placeholder={t('project.searchPlaceholder')}
            aria-label={t('project.searchPlaceholder')}
            className="pl-8"
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus | 'ALL')}>
          <option value="ALL">{t('projectsAdmin.allStatuses')}</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {projectStatusLabels(t)[s]}
            </option>
          ))}
        </Select>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        {t('projectsAdmin.total', { count: shown.length })}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">{t('common.project')}</th>
              <th className="px-3 py-2">{t('common.status')}</th>
              <th className="px-3 py-2 text-right">{t('nav.members')}</th>
              <th className="px-3 py-2 text-right">{t('projectsAdmin.seqShort')}</th>
              <th className="px-3 py-2 text-right">{t('shots.title')}</th>
              <th className="px-3 py-2 text-right">Assets</th>
              <th className="px-3 py-2 text-right">Versions</th>
              <th className="px-3 py-2 text-right">{t('trash.group.media')}</th>
              <th className="px-3 py-2">{t('storage.title')}</th>
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
                    <Badge variant="secondary">{projectStatusLabels(t)[p.status]}</Badge>
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
                  {t('project.noMatch')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
