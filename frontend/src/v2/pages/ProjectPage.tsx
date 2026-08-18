// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback } from 'react';
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
import ProjectSettingsTab from '../components/ProjectSettingsTab';
import OverviewTab from './project/OverviewTab';
import ShotsTab from './project/ShotsTab';
import SequencesTab from './project/SequencesTab';
import AssetsTab from './project/AssetsTab';
import MembersTab from './project/MembersTab';
import PlaylistsTab from './project/PlaylistsTab';
import ProductionTab from './project/ProductionTab';
import SharesTab from './project/SharesTab';
import TrashTab from './project/TrashTab';
import ShotgridTab from './project/ShotgridTab';
import { useSgConnection } from '../lib/shotgridApi';
import ProjectCsvActions from './project/ProjectCsvActions';
import type { ProjectSettings } from './project/projectTypes';
import { useT } from '../i18n';

/** Page projet — orchestrateur des onglets (découpage 10.C1, sous-composants dans pages/project/). */
export default function ProjectPage() {
  const t = useT();
  const { id } = useParams();
  const projectId = parseIdParam(id);
  const role = useAuth((s) => s.user?.role);
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';
  const [searchParams, setSearchParams] = useSearchParams();
  // Le tab vit dans l'URL (deep-links sidebar/favoris/breadcrumb : ?tab=sequences&seq=ID)
  // — back/forward navigateur cohérents (10.A6).
  const tab = searchParams.get('tab') ?? 'overview';
  const setTab = (t: string) => setSearchParams(t === 'overview' ? {} : { tab: t });

  const qc = useQueryClient();
  const { data: projData } = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<{ project: { name: string; startFrame: number } }>(`/api/projects/${projectId}`),
  });
  const name = projData?.project.name ?? '';
  // URL parlante : remplace `/projects/390` par `/projects/le-projet-390` une fois le nom connu.
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
  // Une connexion ShotGrid change ce que la page propose : onglet dédié, liens vers le
  // site, verrou de création. Sans elle, rien de tout cela n'apparaît.
  const { data: sgConnection } = useSgConnection(projectId);

  const tabs = [
    { key: 'overview', label: t('project.tab.overview'), icon: <LayoutDashboard size={16} /> },
    // L'ordre suit la hiérarchie du pipe, de l'ensemble vers le détail : une séquence
    // contient des plans, pas l'inverse.
    { key: 'sequences', label: t('sequences.title'), icon: <Film size={16} />, badge: sequences.length },
    { key: 'shots', label: t('shots.title'), icon: <Clapperboard size={16} />, badge: shots.length },
    { key: 'assets', label: 'Assets', icon: <Box size={16} />, badge: assets.length },
    { key: 'playlists', label: 'Playlists', icon: <ListVideo size={16} /> },
    { key: 'production', label: t('project.tab.production'), icon: <BarChart3 size={16} /> },
    ...(canManage ? [{ key: 'members', label: t('nav.members'), icon: <Users size={16} /> }] : []),
    ...(canManage ? [{ key: 'shares', label: t('project.tab.shares'), icon: <Share2 size={16} /> }] : []),
    ...(canManage ? [{ key: 'settings', label: t('admin.tab.settings'), icon: <Settings size={16} /> }] : []),
    ...(canManage ? [{ key: 'trash', label: t('admin.tab.trash'), icon: <Trash2 size={16} /> }] : []),
    // ShotGrid (48) : l'onglet n'existe que sur un projet relié. Un studio sans ShotGrid
    // ne doit pas voir l'intégration du tout ; la liaison se fait depuis les réglages du
    // projet, qui est l'endroit où l'on décide de relier.
    ...(canManage && sgConnection?.active
      ? [{ key: 'shotgrid', label: t('shotgrid.tab.label'), icon: <Workflow size={16} /> }]
      : []),
  ];

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

      {tab === 'overview' && (
        <OverviewTab
          name={name}
          projectId={projectId}
          canManage={canManage}
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
      {tab === 'production' && <ProductionTab projectId={projectId} />}
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
    </PageShell>
  );
}
