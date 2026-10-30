// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Suspense, lazy, useCallback } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Clapperboard,
  Film,
  Box,
  ListVideo,
  Users,
  Trash2,
  KanbanSquare,
  PenTool,
  Settings,
  Share2,
  BarChart3,
  Workflow,
} from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { entitySlug, projectPath, parseIdParam } from '../lib/slug';
import { useCanonicalSlug } from '../lib/useCanonicalSlug';
import { useSequencesQuery, useShotsQuery, useAssetsQuery } from '../lib/queries';
import { useAuth } from '../stores/useAuth';
import FavoriteButton from '../components/FavoriteButton';
import PageShell from '../components/PageShell';
import { PageHeader } from '../components/ui/page';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import Tabs from '../components/Tabs';
import OverviewTab from './project/OverviewTab';
import { useSgConnection } from '../lib/shotgridApi';
import { useEpisodesEnabled } from '../lib/episodesApi';
import ProjectCsvActions from './project/ProjectCsvActions';
import type { ProjectSettings } from './project/projectTypes';
import { useT } from '../i18n';
import EntityUnavailable from '../components/EntityUnavailable';
import { isBadId, isMissingOrForbidden } from '../components/entityAvailability';

/**
 * Only one tab is mounted at a time (the URL's `?tab=`): the other eleven have no
 * reason to be downloaded (F4). "Overview" stays static: it is the default tab,
 * so it travels with the page rather than in an extra round trip.
 */
const ProjectSettingsTab = lazy(() => import('../components/ProjectSettingsTab'));
const ShotsTab = lazy(() => import('./project/ShotsTab'));
const SequencesTab = lazy(() => import('./project/SequencesTab'));
const EpisodesTab = lazy(() => import('./project/EpisodesTab'));
const AssetsTab = lazy(() => import('./project/AssetsTab'));
const MembersTab = lazy(() => import('./project/MembersTab'));
const PlaylistsTab = lazy(() => import('./project/PlaylistsTab'));
const ProductionTab = lazy(() => import('./project/ProductionTab'));
const SharesTab = lazy(() => import('./project/SharesTab'));
const TrashTab = lazy(() => import('./project/TrashTab'));
const ShotgridTab = lazy(() => import('./project/ShotgridTab'));

/** Project page: tab orchestrator (split 10.C1, sub-components in pages/project/). */
export default function ProjectPage() {
  const t = useT();
  const { id } = useParams();
  const projectId = parseIdParam(id);
  const role = useAuth((s) => s.user?.role);
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';
  const [searchParams, setSearchParams] = useSearchParams();
  // The tab lives in the URL (sidebar/bookmark/breadcrumb deep links: ?tab=sequences&seq=ID)
  // so that browser back/forward stay consistent (10.A6).
  const tab = searchParams.get('tab') ?? 'overview';
  const setTab = (t: string) => setSearchParams(t === 'overview' ? {} : { tab: t });

  const qc = useQueryClient();
  const projQ = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<{ project: { name: string; startFrame: number } }>(`/api/projects/${projectId}`),
  });
  const projData = projQ.data;
  const name = projData?.project.name ?? '';
  // Readable URL: replaces `/projects/390` with `/projects/the-project-390` once the name is known.
  useCanonicalSlug(id, name ? entitySlug(name, projectId) : null);
  const { data: settingsData } = useQuery({
    queryKey: qk.projectSettings(projectId),
    queryFn: () => api.get<{ settings: ProjectSettings }>(`/api/projects/${projectId}/settings`),
  });
  const settings = settingsData?.settings ?? null;

  const seqQ = useSequencesQuery(projectId);
  const shotsQ = useShotsQuery(projectId);
  const assetsQ = useAssetsQuery(projectId);
  const sequences = seqQ.data?.sequences ?? [];
  const shots = shotsQ.data ?? [];
  const assets = assetsQ.data ?? [];
  const error = (seqQ.error ?? shotsQ.error ?? assetsQ.error)?.message ?? null;

  const loadStructure = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.sequences(projectId) }),
      qc.invalidateQueries({ queryKey: qk.shots(projectId) }),
      qc.invalidateQueries({ queryKey: qk.assets(projectId) }),
    ]);
  }, [qc, projectId]);

  const nomenclature = settings?.nomenclature ?? {
    sequencePrefix: 'SQ',
    shotPrefix: 'SH',
    padding: 3,
    step: 10,
  };
  // A ShotGrid connection changes what the page offers: a dedicated tab, links to the
  // site, a creation lock. Without it, none of this appears.
  const { data: sgConnection } = useSgConnection(projectId);
  // Episode level: optional, off by default. Until the server confirms it is active, the
  // tab does not exist: a feature film sees no trace of it.
  const episodesEnabled = useEpisodesEnabled(projectId);

  const tabs = [
    { key: 'overview', label: t('project.tab.overview'), icon: <LayoutDashboard size={16} /> },
    // The order follows the pipe hierarchy, from the whole to the detail: a sequence
    // contains shots, not the other way round.
    ...(episodesEnabled
      ? [{ key: 'episodes', label: t('episodes.title'), icon: <Clapperboard size={16} /> }]
      : []),
    { key: 'sequences', label: t('sequences.title'), icon: <Film size={16} />, badge: sequences.length },
    // The badge shows the project total, not what is loaded: lists are now
    // infinite, so `shots.length` would only be the first page.
    { key: 'shots', label: t('shots.title'), icon: <Clapperboard size={16} />, badge: shotsQ.total },
    { key: 'assets', label: 'Assets', icon: <Box size={16} />, badge: assetsQ.total },
    { key: 'playlists', label: 'Playlists', icon: <ListVideo size={16} /> },
    // Production tracking exposes each member's workload, late items and
    // unassigned tasks: since phase 50 its reads are restricted server-side to
    // those who manage the project. Without this guard, an artist would see the tab and find only
    // errors there.
    ...(canManage
      ? [{ key: 'production', label: t('project.tab.production'), icon: <BarChart3 size={16} /> }]
      : []),
    ...(canManage ? [{ key: 'members', label: t('nav.members'), icon: <Users size={16} /> }] : []),
    ...(canManage ? [{ key: 'shares', label: t('project.tab.shares'), icon: <Share2 size={16} /> }] : []),
    ...(canManage ? [{ key: 'settings', label: t('admin.tab.settings'), icon: <Settings size={16} /> }] : []),
    ...(canManage ? [{ key: 'trash', label: t('admin.tab.trash'), icon: <Trash2 size={16} /> }] : []),
    // ShotGrid (48): the tab exists only on a linked project. A studio without ShotGrid
    // must not see the integration at all; the link is made from the project
    // settings, which is where one decides to link.
    ...(canManage && sgConnection?.active
      ? [{ key: 'shotgrid', label: t('shotgrid.tab.label'), icon: <Workflow size={16} /> }]
      : []),
  ];

  // Unknown, deleted or closed project: the page mounted its twelve tabs on an
  // empty project, and each tab fired its own requests doomed to fail.
  if (isBadId(projectId) || (projQ.isError && isMissingOrForbidden(projQ.error)))
    return <EntityUnavailable kind="project" error={isBadId(projectId) ? undefined : projQ.error} />;
  if (projQ.isError)
    return <EntityUnavailable kind="project" error={projQ.error} onRetry={() => void projQ.refetch()} />;

  return (
    <PageShell
      title={name || t('entity.project')}
      breadcrumb={<EntityBreadcrumb entity="project" id={projectId} />}
    >
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold">{name || t('entity.project')}</h1>
            <FavoriteButton type="PROJECT" entityId={projectId} size={18} />
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {canManage && <ProjectCsvActions projectId={projectId} onImported={loadStructure} />}
            <Link
              to={projectPath({ id: projectId, name }, '/kanban')}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 hover:bg-secondary/60"
            >
              <KanbanSquare size={16} /> Kanban
            </Link>
            <Link
              to={projectPath({ id: projectId, name }, '/board')}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 hover:bg-secondary/60"
            >
              <PenTool size={16} /> Board
            </Link>
          </div>
        }
      />
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {/* Boundary for deferred tabs: the header and tab bar stay in place
          while downloading, only the content area waits, same contract as
          the shell for pages (D3).

          `key={tab}` is not cosmetic. The router wraps its navigations in a
          React transition; a boundary **already mounted** that starts to wait
          then does not show its fallback: React prefers to keep the previous screen, and the click on
          the tab seems to do nothing until the module arrives. One key per tab creates
          a fresh boundary, with no content to preserve, it shows its fallback
          right away, and the URL is written without waiting for the download. */}
      <Suspense
        key={tab}
        fallback={<div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div>}
      >
        {tab === 'overview' && (
          <OverviewTab
            name={name}
            projectId={projectId}
            counts={{ sequences: sequences.length, shots: shots.length, assets: assets.length }}
            onGo={setTab}
          />
        )}
        {tab === 'shots' && (
          <ShotsTab
            projectId={projectId}
            sequences={sequences}
            shots={shots}
            canManage={canManage}
            reload={loadStructure}
            nomenclature={nomenclature}
          />
        )}
        {/* The guard is double: the tab does not exist, and the content is not mounted,
          so a copied `?tab=episodes` makes nothing appear. */}
        {tab === 'episodes' && episodesEnabled && <EpisodesTab projectId={projectId} canManage={canManage} />}
        {tab === 'sequences' && (
          <SequencesTab
            projectId={projectId}
            sequences={sequences}
            canManage={canManage}
            reload={loadStructure}
            nomenclature={nomenclature}
          />
        )}
        {tab === 'assets' && (
          <AssetsTab projectId={projectId} assets={assets} canManage={canManage} reload={loadStructure} />
        )}
        {tab === 'playlists' && <PlaylistsTab projectId={projectId} />}
        {tab === 'production' && canManage && <ProductionTab projectId={projectId} />}
        {tab === 'members' && canManage && <MembersTab projectId={projectId} />}
        {tab === 'shares' && canManage && <SharesTab projectId={projectId} />}
        {tab === 'settings' && canManage && (
          <ProjectSettingsTab
            projectId={projectId}
            startFrame={projData?.project.startFrame ?? 1001}
            onStartFrameChange={() => qc.invalidateQueries({ queryKey: qk.project(projectId) })}
            settings={settings}
            onSettingsChange={() => qc.invalidateQueries({ queryKey: qk.projectSettings(projectId) })}
          />
        )}
        {tab === 'trash' && canManage && <TrashTab projectId={projectId} reload={loadStructure} />}
        {tab === 'shotgrid' && canManage && <ShotgridTab projectId={projectId} canManage={canManage} />}
      </Suspense>
    </PageShell>
  );
}
