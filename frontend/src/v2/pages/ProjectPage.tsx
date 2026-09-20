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
 * Un seul onglet est monté à la fois (le `?tab=` de l'URL) : les onze autres n'ont aucune
 * raison d'être téléchargés (F4). « Vue d'ensemble » reste statique — c'est l'onglet par
 * défaut, il voyage donc avec la page plutôt que dans un aller-retour supplémentaire.
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
  const projQ = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<{ project: { name: string; startFrame: number } }>(`/api/projects/${projectId}`),
  });
  const projData = projQ.data;
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
  // Niveau Épisode : facultatif, éteint par défaut. Tant que le serveur ne l'a pas
  // confirmé actif, l'onglet n'existe pas — un long-métrage n'en voit aucune trace.
  const episodesEnabled = useEpisodesEnabled(projectId);

  const tabs = [
    { key: 'overview', label: t('project.tab.overview'), icon: <LayoutDashboard size={16} /> },
    // L'ordre suit la hiérarchie du pipe, de l'ensemble vers le détail : une séquence
    // contient des plans, pas l'inverse.
    ...(episodesEnabled
      ? [{ key: 'episodes', label: t('episodes.title'), icon: <Clapperboard size={16} /> }]
      : []),
    { key: 'sequences', label: t('sequences.title'), icon: <Film size={16} />, badge: sequences.length },
    // Le badge annonce le total du projet, pas ce qui est chargé : les listes sont
    // désormais infinies, `shots.length` ne vaudrait que la première page.
    { key: 'shots', label: t('shots.title'), icon: <Clapperboard size={16} />, badge: shotsQ.total },
    { key: 'assets', label: 'Assets', icon: <Box size={16} />, badge: assetsQ.total },
    { key: 'playlists', label: 'Playlists', icon: <ListVideo size={16} /> },
    // Le suivi de production expose la charge nominative de l'équipe, les retards et les
    // tâches non assignées : depuis la phase 50 ses lectures sont réservées côté serveur à
    // qui gère le projet. Sans ce garde, un artiste verrait l'onglet et n'y trouverait que
    // des erreurs.
    ...(canManage
      ? [{ key: 'production', label: t('project.tab.production'), icon: <BarChart3 size={16} /> }]
      : []),
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

  // Projet inconnu, supprimé ou fermé : la page montait ses douze onglets sur un projet
  // vide, et chaque onglet lançait ses propres requêtes vouées à échouer.
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

      {/* Frontière des onglets différés : l'en-tête et la barre d'onglets restent en place
          pendant le téléchargement, seule la zone de contenu attend — même contrat que la
          coquille pour les pages (D3).

          `key={tab}` n'est pas cosmétique. Le routeur enveloppe ses navigations dans une
          transition React ; une frontière **déjà montée** qui se met à attendre ne montre
          alors pas son repli : React préfère garder l'écran précédent, et le clic sur
          l'onglet semble ne rien faire jusqu'à l'arrivée du module. Une clé par onglet crée
          une frontière neuve — sans contenu à préserver, elle affiche son repli tout de
          suite, et l'URL est écrite sans attendre le téléchargement. */}
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
        {/* Le garde est double : l'onglet n'existe pas, et le contenu ne se monte pas —
          un `?tab=episodes` recopié ne fait donc rien apparaître. */}
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
