// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { SkeletonRows } from '../../components/ui/skeleton';
import { fmtDateTime } from './adminShared';
import type { AdminProjectRow, AdminVersionRow, MediaKind, Paginated, VersionStatus } from '../../types/api';
import { useT } from '../../i18n';

const PAGE_SIZE = 50;
const KINDS: MediaKind[] = ['VIDEO', 'IMAGE', 'MODEL_3D', 'SPLAT'];
const STATUSES: VersionStatus[] = ['DRAFT', 'REVIEW', 'PUBLISHED'];

/** Liste globale des versions (tous projets) : filtres, pagination, accès à la review. */
export default function VersionsTab() {
  const t = useT();
  const [params] = useSearchParams();
  const [projectId, setProjectId] = useState(params.get('projectId') ?? '');
  const [status, setStatus] = useState('');
  const [published, setPublished] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const projectsQ = useQuery({
    queryKey: qk.adminProjects,
    queryFn: () => api.get<{ projects: AdminProjectRow[] }>('/api/admin/projects'),
  });
  const filter = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (projectId) filter.set('projectId', projectId);
  if (status) filter.set('status', status);
  if (published) filter.set('published', published);
  if (kind) filter.set('kind', kind);
  if (q.trim()) filter.set('q', q.trim());
  const listQ = useQuery({
    queryKey: qk.adminVersions(filter.toString()),
    queryFn: () => api.get<Paginated<AdminVersionRow>>(`/api/admin/versions?${filter}`),
  });

  const projects = projectsQ.data?.projects ?? [];
  const projectName = (id: number | null) => projects.find((p) => p.id === id)?.name ?? '—';
  const resetPage = () => setPage(1);

  if (!listQ.data) return <SkeletonRows count={6} />;
  const { items, total } = listQ.data;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              resetPage();
            }}
            placeholder={t('versions.namePlaceholder')}
            className="pl-8"
          />
        </div>
        <Select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            resetPage();
          }}
        >
          <option value="">{t('reviews.filter.allProjects')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            resetPage();
          }}
        >
          <option value="">{t('projectsAdmin.allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          value={published}
          onChange={(e) => {
            setPublished(e.target.value);
            resetPage();
          }}
        >
          <option value="">{t('versions.publication')}</option>
          <option value="true">{t('versions.published')}</option>
          <option value="false">{t('versions.unpublished')}</option>
        </Select>
        <Select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            resetPage();
          }}
        >
          <option value="">{t('versions.allMedia')}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </Select>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{total} version(s) au total.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Version</th>
              <th className="px-3 py-2">Localisation</th>
              <th className="px-3 py-2">Projet</th>
              <th className="px-3 py-2">{t('versions.decision')}</th>
              <th className="px-3 py-2">Publication</th>
              <th className="px-3 py-2">{t('trash.group.media')}</th>
              <th className="px-3 py-2">Auteur</th>
              <th className="px-3 py-2">{t('stats.created')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((v) => (
              <tr key={v.id} className="border-t border-border hover:bg-secondary/40">
                <td className="px-3 py-2">
                  {v.firstMediaId ? (
                    <Link to={`/review/${v.firstMediaId}`} className="font-medium hover:underline">
                      {v.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{v.name}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{v.location || '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{projectName(v.projectId)}</td>
                <td className="px-3 py-2">
                  {v.reviewStatus ? (
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: v.reviewStatus.color }}
                      />
                      {v.reviewStatus.name}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge variant="secondary">{v.published ? t('version.publishedLower') : v.status}</Badge>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {v.mediaCount > 0 ? `${v.mediaCount} · ${v.kinds.join(', ')}` : '0'}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{v.author?.name ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDateTime(v.createdAt)}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {t('versions.noMatch')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('common.previous')}
          </Button>
          <span>
            Page {page} / {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t('common.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
