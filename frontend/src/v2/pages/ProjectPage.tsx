import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Clapperboard, Film, Box, Users, Trash2, KanbanSquare, PenTool, Settings } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { useAuth } from '../stores/useAuth';
import FavoriteButton from '../components/FavoriteButton';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import Tabs from '../components/Tabs';
import ProjectSettingsTab from '../components/ProjectSettingsTab';
import OverviewTab from './project/OverviewTab';
import ShotsTab from './project/ShotsTab';
import SequencesTab from './project/SequencesTab';
import AssetsTab from './project/AssetsTab';
import MembersTab from './project/MembersTab';
import TrashTab from './project/TrashTab';
import type { Asset, ProjectSettings, Sequence, Shot } from './project/projectTypes';

/** Page projet — orchestrateur des onglets (découpage 10.C1, sous-composants dans pages/project/). */
export default function ProjectPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const role = useAuth((s) => s.user?.role);
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';
  const [searchParams, setSearchParams] = useSearchParams();
  // Le tab vit dans l'URL (deep-links sidebar/favoris/breadcrumb : ?tab=shots&shot=ID,
  // ?tab=sequences&seq=ID) — back/forward navigateur cohérents (10.A6).
  const tab = searchParams.get('tab') ?? 'overview';
  const setTab = (t: string) => setSearchParams(t === 'overview' ? {} : { tab: t });
  // L'entité ouverte (drawer shot / accordéon séquence) vit aussi dans l'URL.
  const focusShot = searchParams.get('shot') ? Number(searchParams.get('shot')) : null;
  const focusSeq = searchParams.get('seq') ? Number(searchParams.get('seq')) : null;
  const setFocusShot = (id: number | null) => setSearchParams(id ? { tab: 'shots', shot: String(id) } : { tab: 'shots' });
  const setFocusSeq = (id: number | null) => setSearchParams(id ? { tab: 'sequences', seq: String(id) } : { tab: 'sequences' });
  const [name, setName] = useState('');
  const [startFrame, setStartFrame] = useState<number>(1001);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStructure = useCallback(async () => {
    const [seq, sh, as] = await Promise.all([
      api.get<{ sequences: Sequence[] }>(`/api/sequences?projectId=${projectId}`),
      api.get<{ shots: Shot[] }>(`/api/shots?projectId=${projectId}`),
      api.get<{ assets: Asset[] }>(`/api/assets?projectId=${projectId}`),
    ]);
    setSequences(seq.sequences); setShots(sh.shots); setAssets(as.assets);
  }, [projectId]);

  useEffect(() => {
    api.get<{ project: { name: string; startFrame: number } }>(`/api/projects/${projectId}`)
      .then((p) => { setName(p.project.name); setStartFrame(p.project.startFrame); })
      .catch(() => undefined);
    api.get<{ settings: ProjectSettings }>(`/api/projects/${projectId}/settings`)
      .then((d) => setSettings(d.settings)).catch(() => undefined);
    loadStructure().catch((e) => setError(e instanceof Error ? e.message : 'Erreur'));
  }, [projectId, loadStructure]);

  const nomenclature = settings?.nomenclature ?? { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 3, step: 10 };

  const tabs = [
    { key: 'overview', label: "Vue d'ensemble", icon: <LayoutDashboard size={16} /> },
    { key: 'shots', label: 'Shots', icon: <Clapperboard size={16} />, badge: shots.length },
    { key: 'sequences', label: 'Séquences', icon: <Film size={16} />, badge: sequences.length },
    { key: 'assets', label: 'Assets', icon: <Box size={16} />, badge: assets.length },
    ...(canManage ? [{ key: 'members', label: 'Membres', icon: <Users size={16} /> }] : []),
    ...(canManage ? [{ key: 'settings', label: 'Réglages', icon: <Settings size={16} /> }] : []),
    ...(canManage ? [{ key: 'trash', label: 'Corbeille', icon: <Trash2 size={16} /> }] : []),
  ];

  return (
    <Shell title={name || 'Projet'} breadcrumb={<EntityBreadcrumb entity="project" id={projectId} />}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{name || 'Projet'}</h1>
          <FavoriteButton type="PROJECT" entityId={projectId} size={18} />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link to={`/projects/${projectId}/kanban`} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 hover:bg-secondary/60">
            <KanbanSquare size={16} /> Kanban
          </Link>
          <Link to={`/projects/${projectId}/board`} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 hover:bg-secondary/60">
            <PenTool size={16} /> Board
          </Link>
        </div>
      </div>
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
        <ShotsTab projectId={projectId} sequences={sequences} shots={shots} canManage={canManage} reload={loadStructure} focusId={focusShot} onFocus={setFocusShot} nomenclature={nomenclature} />
      )}
      {tab === 'sequences' && (
        <SequencesTab projectId={projectId} sequences={sequences} canManage={canManage} reload={loadStructure} focusId={focusSeq} onFocus={setFocusSeq} nomenclature={nomenclature} />
      )}
      {tab === 'assets' && (
        <AssetsTab projectId={projectId} assets={assets} canManage={canManage} reload={loadStructure} />
      )}
      {tab === 'members' && canManage && <MembersTab projectId={projectId} />}
      {tab === 'settings' && canManage && (
        <ProjectSettingsTab
          projectId={projectId}
          startFrame={startFrame}
          onStartFrameChange={setStartFrame}
          settings={settings}
          onSettingsChange={setSettings}
        />
      )}
      {tab === 'trash' && canManage && <TrashTab projectId={projectId} reload={loadStructure} />}
    </Shell>
  );
}
