// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import Avatar from '../../components/Avatar';
import { Badge } from '../../components/ui/badge';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Metric, Panel, Row } from './AdminPrimitives';
import { fmtBytes, fmtDateTime } from './adminShared';
import { pipelineLabel, PROJECT_STATUS_LABELS, quotaPct } from './adminProjects';
import ProjectHierarchy from './ProjectHierarchy';
import type { AdminProjectDetail } from '../../types/api';
import { useT } from '../../i18n';

/** Fiche d'administration d'un projet : membres, réglages résolus, hiérarchie, stats. */
export default function ProjectAdminDetailTab() {
  const t = useT();
  const { id } = useParams();
  const projectId = Number(id);
  const detailQ = useQuery({
    queryKey: qk.adminProject(projectId),
    queryFn: () => api.get<AdminProjectDetail>(`/api/admin/projects/${projectId}`),
    enabled: Number.isInteger(projectId) && projectId > 0,
  });

  if (!detailQ.data) return <SkeletonRows count={6} />;
  const { project, members, settings, hierarchy, stats } = detailQ.data;
  const pct = quotaPct(project.usage, project.quota);

  return (
    <div className="space-y-6">
      <Link
        to="/admin/projects"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} /> {t('nav.projects')}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{project.name}</h2>
            <Badge variant="secondary">{PROJECT_STATUS_LABELS[project.status]}</Badge>
            {project.deletedAt && <Badge variant="secondary">corbeille</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {project.slug} · créé le {fmtDateTime(project.createdAt)} · modifié le{' '}
            {fmtDateTime(project.updatedAt)}
          </p>
          {project.description && (
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>
        <Link
          to={`/projects/${project.id}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t('project.openProject')} <ExternalLink size={13} />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Metric
          label={t('storage.title')}
          value={fmtBytes(project.usage)}
          sub={
            project.quota != null ? `quota ${fmtBytes(project.quota)} (${pct ?? 0}%)` : t('common.noQuota')
          }
        />
        <Metric label="Versions" value={stats.versions} to={`/admin/versions?projectId=${project.id}`} />
        <Metric label={t('trash.group.media')} value={stats.media} sub={fmtBytes(stats.mediaBytes)} />
        <Metric
          label={t('admin.tab.comments')}
          value={stats.comments}
          to={`/admin/comments?projectId=${project.id}`}
        />
        <Metric label="Assets" value={stats.assets} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Membres (${members.length})`}>
          <div className="space-y-1.5">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-sm">
                <Avatar
                  seed={m.user.id}
                  initials={m.user.initials ?? '?'}
                  avatarUrl={m.user.avatarUrl}
                  size={24}
                />
                <Link
                  to={`/admin/users/${m.user.id}`}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {m.user.displayName ?? m.user.email}
                </Link>
                <Badge variant="secondary">{m.role ?? m.user.role}</Badge>
                <span className="shrink-0 text-xs text-muted-foreground">
                  depuis le {fmtDateTime(m.joinedAt)}
                </span>
              </div>
            ))}
            {members.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('project.noExplicitMember')}</p>
            )}
          </div>
        </Panel>

        <Panel title={t('overview.resolvedSettings')}>
          <dl className="space-y-1 text-sm">
            <Row k="Pipeline" v={pipelineLabel(settings)} />
            <Row k={t('pipeline.startFrame')} v={String(project.startFrame)} />
            <Row
              k={t('pipeline.naming')}
              v={`${settings.nomenclature.sequencePrefix}### / ${settings.nomenclature.shotPrefix}### (pas ${settings.nomenclature.step})`}
            />
            <Row
              k={t('pipeline.departments')}
              v={settings.departments.length ? settings.departments.map((d) => d.name).join(', ') : '—'}
            />
            <Row
              k={t('projectAdmin.naming')}
              v={
                settings.naming.mode === 'off'
                  ? 'libre'
                  : `${settings.naming.mode} (${settings.naming.pattern})`
              }
            />
          </dl>
          <p className="mt-2 text-[11px] text-muted-foreground">{t('projectAdmin.hint')}</p>
        </Panel>
      </div>

      <ProjectHierarchy
        sequences={hierarchy.sequences}
        noSequence={hierarchy.noSequence}
        project={{ resolution: settings.resolution, framerate: settings.framerate }}
      />
    </div>
  );
}
