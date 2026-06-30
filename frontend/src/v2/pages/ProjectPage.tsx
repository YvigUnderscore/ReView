import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Clapperboard, Film, Box, Users, Trash2, Plus, KanbanSquare, PenTool, Link2, Star, Settings } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { useAuth, type Role } from '../stores/useAuth';
import { useFavorites } from '../stores/useFavorites';
import FavoriteButton from '../components/FavoriteButton';
import Shell from '../components/Shell';
import Tabs from '../components/Tabs';
import ViewToggle, { useViewMode } from '../components/ViewToggle';
import EntityCard, { EntityContainer, EditIcon, DeleteIcon } from '../components/EntityCard';
import ConfirmDialog from '../components/ConfirmDialog';
import MultiRowCreate from '../components/MultiRowCreate';
import BatchGenerator from '../components/BatchGenerator';
import AssetAssignDialog from '../components/AssetAssignDialog';
import ProjectActivity from '../components/ProjectActivity';
import ProjectSettingsTab from '../components/ProjectSettingsTab';

export interface Nomenclature { sequencePrefix: string; shotPrefix: string; padding: number; step: number; }
export interface Department { key: string; name: string; }
export interface ProjectSettings { departments: Department[]; nomenclature: Nomenclature; }

interface AssetRef { id: number; name: string; type: string; }
interface Sequence { id: number; name: string; code: string; order: number; }
interface Shot { id: number; name: string; code: string; sequenceId: number | null; thumbnailUrl?: string | null; _count?: { tasks: number }; assets?: AssetRef[]; }
interface Task { id: number; name: string; type: string; status: string; }
interface Asset { id: number; name: string; type: string; thumbnailUrl?: string | null; }
interface SequenceDetailData {
  id: number; code: string; name: string;
  shots: { id: number; code: string; name: string; assets: AssetRef[] }[];
  assets: AssetRef[];
}
interface Member { id: number; role: Role | null; user: { id: number; name: string | null; email: string; role: Role }; }

const ASSET_TYPES = ['CHARACTER', 'PROP', 'ENVIRONMENT', 'VEHICLE', 'FX', 'OTHER'];
const TASK_TYPES = ['ANIMATION', 'FX', 'COMPOSITING', 'LIGHTING', 'MODELING', 'RIGGING', 'LOOKDEV', 'LAYOUT', 'OTHER'];
const STATUS_COLOR: Record<string, string> = {
  TODO: 'bg-muted text-muted-foreground',
  IN_PROGRESS: 'bg-blue-500/20 text-blue-300',
  PENDING_REVIEW: 'bg-amber-500/20 text-amber-300',
  APPROVED: 'bg-green-500/20 text-green-300',
  REJECTED: 'bg-red-500/20 text-red-300',
  RETAKE: 'bg-orange-500/20 text-orange-300',
};

export default function ProjectPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const role = useAuth((s) => s.user?.role);
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';
  const [searchParams] = useSearchParams();
  // Deep-link favoris : ?tab=shots&shot=ID ou ?tab=sequences&seq=ID
  const [tab, setTab] = useState(searchParams.get('tab') ?? 'overview');
  const focusShot = searchParams.get('shot') ? Number(searchParams.get('shot')) : null;
  const focusSeq = searchParams.get('seq') ? Number(searchParams.get('seq')) : null;
  const [name, setName] = useState('');
  const [startFrame, setStartFrame] = useState<number>(1001);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStructure = async () => {
    const [seq, sh, as] = await Promise.all([
      api.get<{ sequences: Sequence[] }>(`/api/sequences?projectId=${projectId}`),
      api.get<{ shots: Shot[] }>(`/api/shots?projectId=${projectId}`),
      api.get<{ assets: Asset[] }>(`/api/assets?projectId=${projectId}`),
    ]);
    setSequences(seq.sequences); setShots(sh.shots); setAssets(as.assets);
  };
  useEffect(() => {
    api.get<{ project: { name: string; startFrame: number } }>(`/api/projects/${projectId}`)
      .then((p) => { setName(p.project.name); setStartFrame(p.project.startFrame); })
      .catch(() => undefined);
    api.get<{ settings: ProjectSettings }>(`/api/projects/${projectId}/settings`)
      .then((d) => setSettings(d.settings)).catch(() => undefined);
    loadStructure().catch((e) => setError(e instanceof Error ? e.message : 'Erreur'));
  }, [projectId]);

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
    <Shell title={name || 'Projet'}>
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
        <ShotsTab projectId={projectId} sequences={sequences} shots={shots} canManage={canManage} reload={loadStructure} focusId={focusShot} nomenclature={nomenclature} />
      )}
      {tab === 'sequences' && (
        <SequencesTab projectId={projectId} sequences={sequences} canManage={canManage} reload={loadStructure} focusId={focusSeq} nomenclature={nomenclature} />
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

// ── Vue d'ensemble ────────────────────────────────────────────────────────────

function OverviewTab({ name, projectId, canManage, counts, onGo }: {
  name: string; projectId: number; canManage: boolean;
  counts: { sequences: number; shots: number; assets: number }; onGo: (k: string) => void;
}) {
  const Card = ({ label, value, to }: { label: string; value: number; to: string }) => (
    <button onClick={() => onGo(to)} className="rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-primary">
      <div className="text-3xl font-semibold">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </button>
  );
  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">Tableau de bord du projet « {name} ».</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card label="Séquences" value={counts.sequences} to="sequences" />
        <Card label="Shots" value={counts.shots} to="shots" />
        <Card label="Assets" value={counts.assets} to="assets" />
      </div>
      {/* Dernières mises à jour + tâches prioritaires + assignation */}
      <ProjectActivity projectId={projectId} canManage={canManage} />
    </div>
  );
}

// Sélecteur de mode de création (simple / lot manuel / génération auto)
function ModeSwitch({ mode, setMode }: { mode: 'simple' | 'manual' | 'auto'; setMode: (m: 'simple' | 'manual' | 'auto') => void }) {
  const opts: { key: 'simple' | 'manual' | 'auto'; label: string }[] = [
    { key: 'simple', label: 'Simple' },
    { key: 'manual', label: 'Lot' },
    { key: 'auto', label: 'Auto' },
  ];
  return (
    <div className="flex overflow-hidden rounded-md border border-border text-xs">
      {opts.map((o) => (
        <button
          key={o.key}
          onClick={() => setMode(o.key)}
          className={`px-2.5 py-1 ${mode === o.key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Onglet Shots ─────────────────────────────────────────────────────────────

function ShotsTab({ projectId, sequences, shots, canManage, reload, focusId = null, nomenclature }: {
  projectId: number; sequences: Sequence[]; shots: Shot[]; canManage: boolean; reload: () => Promise<void>;
  focusId?: number | null; nomenclature: Nomenclature;
}) {
  const view = useViewMode(`shots:${projectId}`);
  const favs = useFavorites((s) => s.favorites);
  const toggleFav = useFavorites((s) => s.toggle);
  const isFav = (id: number) => favs.some((f) => f.type === 'SHOT' && f.entityId === id);
  const [newShot, setNewShot] = useState({ name: '', code: '', sequenceId: '' });
  const [mode, setMode] = useState<'simple' | 'manual' | 'auto'>('simple');
  const [open, setOpen] = useState<number | null>(focusId);
  const [editing, setEditing] = useState<Shot | null>(null);
  const [deleting, setDeleting] = useState<Shot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tri des séquences par ordre puis par code (numérique : SQ001 < SQ002 < SQ010)
  const sortedSequences = [...sequences].sort(
    (a, b) => a.order - b.order || a.code.localeCompare(b.code, undefined, { numeric: true }),
  );

  const createShot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/shots', { projectId, name: newShot.name || newShot.code, code: newShot.code, sequenceId: newShot.sequenceId ? Number(newShot.sequenceId) : null });
      setNewShot({ name: '', code: '', sequenceId: '' }); reload();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };
  const createBulk = async (rows: Record<string, string>[]) => {
    await api.post('/api/shots/bulk', {
      projectId,
      items: rows.map((r) => ({
        code: r.code,
        name: r.name || r.code,
        sequenceId: r.sequenceId ? Number(r.sequenceId) : null,
      })),
    });
    await reload();
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try { await api.del(`/api/shots/${deleting.id}`); setDeleting(null); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };

  const groups = [
    ...sortedSequences.map((s) => ({ seq: s, list: shots.filter((sh) => sh.sequenceId === s.id) })),
    { seq: null as Sequence | null, list: shots.filter((sh) => sh.sequenceId === null) },
  ].filter((g) => g.list.length > 0 || g.seq);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Shots</h2>
        <div className="flex items-center gap-2">
          {canManage && <ModeSwitch mode={mode} setMode={setMode} />}
          <ViewToggle contextKey={`shots:${projectId}`} />
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {canManage && mode === 'auto' && (
        <BatchGenerator
          defaults={{ prefix: nomenclature.shotPrefix, step: nomenclature.step, padding: nomenclature.padding }}
          sequences={sortedSequences}
          onSubmit={(items) => createBulk(items.map((it) => ({ code: it.code, name: it.name, sequenceId: it.sequenceId != null ? String(it.sequenceId) : '' })))}
        />
      )}
      {canManage && mode === 'manual' && (
        <MultiRowCreate
          addLabel="Créer les shots"
          fields={[
            { key: 'code', placeholder: `Code (${nomenclature.shotPrefix}${'0'.repeat(nomenclature.padding)})`, className: 'w-28' },
            { key: 'name', placeholder: 'Nom (optionnel)', className: 'flex-1' },
            {
              key: 'sequenceId',
              placeholder: 'Séquence',
              className: 'w-44',
              options: [
                { value: '', label: 'Sans séquence' },
                ...sortedSequences.map((sq) => ({ value: String(sq.id), label: `${sq.code} · ${sq.name}` })),
              ],
            },
          ]}
          onSubmit={createBulk}
        />
      )}
      {canManage && mode === 'simple' && (
        <form onSubmit={createShot} className="mb-5 flex flex-wrap gap-2 rounded-md border border-border bg-card p-2">
          <input className="w-24 rounded border border-input bg-background px-2 py-1.5 text-xs" placeholder="Code" value={newShot.code} onChange={(e) => setNewShot((s) => ({ ...s, code: e.target.value }))} required />
          <input className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-xs" placeholder="Nom (optionnel)" value={newShot.name} onChange={(e) => setNewShot((s) => ({ ...s, name: e.target.value }))} />
          <select className="rounded border border-input bg-background px-2 py-1.5 text-xs" value={newShot.sequenceId} onChange={(e) => setNewShot((s) => ({ ...s, sequenceId: e.target.value }))}>
            <option value="">Sans séquence</option>
            {sortedSequences.map((sq) => <option key={sq.id} value={sq.id}>{sq.code} · {sq.name}</option>)}
          </select>
          <button className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground"><Plus size={14} /> Shot</button>
        </form>
      )}

      {shots.length === 0 && <p className="text-sm text-muted-foreground">Aucun shot.{canManage ? ' Ajoutez-en un ci-dessus.' : ''}</p>}

      {groups.map((g) => (
        <section key={g.seq?.id ?? 'none'} className="mb-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.seq ? `${g.seq.code} · ${g.seq.name}` : 'Sans séquence'}
          </h3>
          <EntityContainer view={view}>
            {g.list.map((shot) => (
              <EntityCard
                key={shot.id}
                view={view}
                onClick={() => setOpen((o) => (o === shot.id ? null : shot.id))}
                active={open === shot.id}
                title={`${shot.code} · ${shot.name}`}
                subtitle={`${shot._count?.tasks ?? 0} tâche(s)${shot.assets?.length ? ` · ${shot.assets.length} asset(s)` : ''}`}
                thumbnailUrl={shot.thumbnailUrl}
                actions={[
                  { icon: <Star size={15} fill={isFav(shot.id) ? 'currentColor' : 'none'} className={isFav(shot.id) ? 'text-amber-400' : ''} />, label: 'Favori', onClick: () => toggleFav('SHOT', shot.id) },
                  ...(canManage ? [
                    { icon: EditIcon, label: 'Modifier', onClick: () => setEditing(shot) },
                    { icon: DeleteIcon, label: 'Supprimer', danger: true, onClick: () => setDeleting(shot) },
                  ] : []),
                ]}
              />
            ))}
          </EntityContainer>
          {g.list.some((s) => s.id === open) && open != null && (
            <>
              <ShotTasks shotId={open} canManage={canManage} />
              <ShotAssets shotId={open} projectId={projectId} canManage={canManage} reload={reload} />
            </>
          )}
        </section>
      ))}

      {editing && (
        <ShotEditDialog
          shot={editing}
          sequences={sortedSequences}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer le shot ?"
        message={<>Le shot « {deleting?.code} » et ses tâches/versions seront déplacés dans la corbeille.</>}
        confirmLabel="Mettre à la corbeille"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// Modal d'édition d'un shot : code, nom, séquence (réassignation)
function ShotEditDialog({ shot, sequences, onClose, onSaved }: {
  shot: Shot; sequences: Sequence[]; onClose: () => void; onSaved: () => void;
}) {
  const [vals, setVals] = useState({ code: shot.code, name: shot.name, sequenceId: shot.sequenceId ? String(shot.sequenceId) : '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.patch(`/api/shots/${shot.id}`, {
        code: vals.code,
        name: vals.name,
        sequenceId: vals.sequenceId ? Number(vals.sequenceId) : null,
      });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold">Modifier le shot</h3>
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
        <div className="space-y-2">
          <input className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm" placeholder="Code" value={vals.code} onChange={(e) => setVals((v) => ({ ...v, code: e.target.value }))} />
          <input className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm" placeholder="Nom" value={vals.name} onChange={(e) => setVals((v) => ({ ...v, name: e.target.value }))} />
          <select className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm" value={vals.sequenceId} onChange={(e) => setVals((v) => ({ ...v, sequenceId: e.target.value }))}>
            <option value="">Sans séquence</option>
            {sequences.map((sq) => <option key={sq.id} value={sq.id}>{sq.code} · {sq.name}</option>)}
          </select>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60">Annuler</button>
          <button onClick={save} disabled={busy} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  );
}

function ShotTasks({ shotId, canManage }: { shotId: number; canManage: boolean }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [task, setTask] = useState({ name: '', type: 'ANIMATION' });

  const load = () => api.get<{ tasks: Task[] }>(`/api/tasks?shotId=${shotId}`).then((d) => setTasks(d.tasks)).catch(() => setTasks([]));
  useEffect(() => { load(); }, [shotId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.name.trim()) return;
    await api.post('/api/tasks', { shotId, ...task });
    setTask({ name: '', type: 'ANIMATION' }); load();
  };

  return (
    <div className="mt-2 rounded-md border border-border bg-card/50 p-3">
      <ul className="space-y-1">
        {tasks?.length ? tasks.map((t) => (
          <li key={t.id}>
            <Link to={`/tasks/${t.id}`} className="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-muted">
              <span>{t.name} <span className="text-xs text-muted-foreground">({t.type})</span></span>
              <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLOR[t.status] ?? ''}`}>{t.status}</span>
            </Link>
          </li>
        )) : <li className="px-2 py-1 text-xs text-muted-foreground">{tasks === null ? 'Chargement…' : 'Aucune tâche'}</li>}
      </ul>
      {canManage && (
        <form onSubmit={submit} className="mt-2 flex gap-2">
          <input className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs" placeholder="Nouvelle tâche…" value={task.name} onChange={(e) => setTask((s) => ({ ...s, name: e.target.value }))} />
          <select className="rounded border border-input bg-background px-1 py-1 text-xs" value={task.type} onChange={(e) => setTask((s) => ({ ...s, type: e.target.value }))}>
            {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">+ Tâche</button>
        </form>
      )}
    </div>
  );
}

// Assets rattachés à un shot : lister, détacher, rattacher un existant, créer + rattacher
function ShotAssets({ shotId, projectId, canManage, reload }: { shotId: number; projectId: number; canManage: boolean; reload: () => Promise<void> }) {
  const [assets, setAssets] = useState<AssetRef[]>([]);
  const [allAssets, setAllAssets] = useState<AssetRef[]>([]);
  const [pick, setPick] = useState('');
  const [creating, setCreating] = useState({ name: '', type: 'CHARACTER' });
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    const [{ shot }, { assets: all }] = await Promise.all([
      api.get<{ shot: { assets: AssetRef[] } }>(`/api/shots/${shotId}`),
      api.get<{ assets: AssetRef[] }>(`/api/assets?projectId=${projectId}`),
    ]);
    setAssets(shot.assets); setAllAssets(all);
  };
  useEffect(() => { load(); }, [shotId]);

  const linkExisting = async () => {
    if (!pick) return;
    await api.post(`/api/shots/${shotId}/assets`, { assetId: Number(pick) });
    setPick(''); await load(); reload();
  };
  const createAndLink = async () => {
    if (!creating.name.trim()) return;
    await api.post(`/api/shots/${shotId}/assets`, { name: creating.name, type: creating.type });
    setCreating({ name: '', type: 'CHARACTER' }); setShowCreate(false); await load(); reload();
  };
  const detach = async (assetId: number) => {
    await api.del(`/api/shots/${shotId}/assets/${assetId}`); await load(); reload();
  };

  const linkedIds = new Set(assets.map((a) => a.id));
  const available = allAssets.filter((a) => !linkedIds.has(a.id));

  return (
    <div className="mt-2 rounded-md border border-border bg-card/50 p-3">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assets du shot</div>
      <div className="flex flex-wrap gap-1.5">
        {assets.length === 0 && <span className="text-xs text-muted-foreground">Aucun asset.</span>}
        {assets.map((a) => (
          <span key={a.id} className="flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-xs">
            <Link to={`/assets/${a.id}`} className="hover:text-primary">{a.name} <span className="text-muted-foreground">· {a.type}</span></Link>
            {canManage && <button onClick={() => detach(a.id)} title="Détacher" className="text-muted-foreground hover:text-destructive">×</button>}
          </span>
        ))}
      </div>
      {canManage && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select className="rounded border border-input bg-background px-2 py-1 text-xs" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Rattacher un asset existant…</option>
            {available.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.type}</option>)}
          </select>
          <button onClick={linkExisting} disabled={!pick} className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">Rattacher</button>
          <button onClick={() => setShowCreate((s) => !s)} className="rounded border border-border px-2 py-1 text-xs hover:bg-secondary/60">+ Créer un asset</button>
          {showCreate && (
            <div className="flex items-center gap-1">
              <input className="w-40 rounded border border-input bg-background px-2 py-1 text-xs" placeholder="Nom de l'asset" value={creating.name} onChange={(e) => setCreating((c) => ({ ...c, name: e.target.value }))} />
              <select className="rounded border border-input bg-background px-1 py-1 text-xs" value={creating.type} onChange={(e) => setCreating((c) => ({ ...c, type: e.target.value }))}>
                {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button onClick={createAndLink} className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">Créer</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Onglet Séquences ──────────────────────────────────────────────────────────

function SequencesTab({ projectId, sequences, canManage, reload, focusId = null, nomenclature }: {
  projectId: number; sequences: Sequence[]; canManage: boolean; reload: () => Promise<void>;
  focusId?: number | null; nomenclature: Nomenclature;
}) {
  const [newSeq, setNewSeq] = useState({ name: '', code: '' });
  const [mode, setMode] = useState<'simple' | 'manual' | 'auto'>('simple');
  const [editing, setEditing] = useState<number | null>(null);
  const [editVals, setEditVals] = useState({ code: '', name: '' });
  const [open, setOpen] = useState<number | null>(focusId);
  const [deleting, setDeleting] = useState<Sequence | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = [...sequences].sort(
    (a, b) => a.order - b.order || a.code.localeCompare(b.code, undefined, { numeric: true }),
  );

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post('/api/sequences', { projectId, code: newSeq.code, name: newSeq.name || newSeq.code }); setNewSeq({ name: '', code: '' }); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };
  const createBulk = async (rows: Record<string, string>[]) => {
    await api.post('/api/sequences/bulk', {
      projectId,
      items: rows.map((r) => ({ code: r.code, name: r.name || r.code })),
    });
    await reload();
  };
  const startEdit = (s: Sequence) => { setEditing(s.id); setEditVals({ code: s.code, name: s.name }); };
  const saveEdit = async (id: number) => {
    try { await api.patch(`/api/sequences/${id}`, editVals); setEditing(null); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try { await api.del(`/api/sequences/${deleting.id}`); setDeleting(null); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Séquences</h2>
        {canManage && <ModeSwitch mode={mode} setMode={setMode} />}
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {canManage && mode === 'auto' && (
        <BatchGenerator
          defaults={{ prefix: nomenclature.sequencePrefix, step: nomenclature.step, padding: nomenclature.padding }}
          onSubmit={(items) => createBulk(items.map((it) => ({ code: it.code, name: it.name })))}
        />
      )}
      {canManage && mode === 'manual' && (
        <MultiRowCreate
          addLabel="Créer les séquences"
          fields={[
            { key: 'code', placeholder: `Code (${nomenclature.sequencePrefix}${'0'.repeat(nomenclature.padding)})`, className: 'w-32' },
            { key: 'name', placeholder: 'Nom (optionnel)', className: 'flex-1' },
          ]}
          onSubmit={createBulk}
        />
      )}
      {canManage && mode === 'simple' && (
        <form onSubmit={create} className="mb-5 flex gap-2 rounded-md border border-border bg-card p-2">
          <input className="w-28 rounded border border-input bg-background px-2 py-1.5 text-xs" placeholder="Code" value={newSeq.code} onChange={(e) => setNewSeq((s) => ({ ...s, code: e.target.value }))} required />
          <input className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-xs" placeholder="Nom (optionnel)" value={newSeq.name} onChange={(e) => setNewSeq((s) => ({ ...s, name: e.target.value }))} />
          <button className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground"><Plus size={14} /> Séquence</button>
        </form>
      )}
      {sequences.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune séquence.</p>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((s) => (
            <div key={s.id} className="rounded-md border border-border bg-card">
              {editing === s.id ? (
                <div className="flex items-center gap-2 px-3 py-2">
                  <input className="w-28 rounded border border-input bg-background px-2 py-1 text-xs" value={editVals.code} onChange={(e) => setEditVals((v) => ({ ...v, code: e.target.value }))} />
                  <input className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs" value={editVals.name} onChange={(e) => setEditVals((v) => ({ ...v, name: e.target.value }))} />
                  <button onClick={() => saveEdit(s.id)} className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">Enregistrer</button>
                  <button onClick={() => setEditing(null)} className="rounded border border-border px-2 py-1 text-xs">Annuler</button>
                </div>
              ) : (
                <div className="group flex items-center justify-between px-3 py-2">
                  <button onClick={() => setOpen((o) => (o === s.id ? null : s.id))} className="text-left text-sm">
                    <span className="font-medium">{s.code}</span> · {s.name}
                  </button>
                  <div className="flex items-center gap-1">
                    <FavoriteButton type="SEQUENCE" entityId={s.id} />
                    {canManage && (
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => startEdit(s)} title="Modifier" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary">{EditIcon}</button>
                        <button onClick={() => setDeleting(s)} title="Supprimer" className="flex h-7 w-7 items-center justify-center rounded-md text-destructive hover:bg-secondary">{DeleteIcon}</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {open === s.id && <SequenceDetail sequenceId={s.id} />}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Supprimer la séquence ?"
        message={<>La séquence « {deleting?.code} » et ses shots seront déplacés dans la corbeille.</>}
        confirmLabel="Mettre à la corbeille"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// Détail d'une séquence : shots + assets assignés (chargé à l'ouverture)
function SequenceDetail({ sequenceId }: { sequenceId: number }) {
  const [data, setData] = useState<SequenceDetailData | null>(null);
  useEffect(() => {
    api.get<{ sequence: SequenceDetailData }>(`/api/sequences/${sequenceId}`)
      .then((d) => setData(d.sequence)).catch(() => setData(null));
  }, [sequenceId]);

  if (!data) return <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Chargement…</div>;
  return (
    <div className="space-y-3 border-t border-border px-3 py-3">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shots ({data.shots.length})</div>
        {data.shots.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucun shot.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.shots.map((sh) => (
              <span key={sh.id} className="rounded border border-border bg-background px-2 py-0.5 text-xs">
                {sh.code} <span className="text-muted-foreground">· {sh.name}</span>
                {sh.assets.length > 0 && <span className="ml-1 text-[10px] text-primary">{sh.assets.length} asset(s)</span>}
              </span>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assets de la séquence ({data.assets.length})</div>
        {data.assets.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucun asset assigné.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.assets.map((a) => (
              <Link key={a.id} to={`/assets/${a.id}`} className="rounded border border-border bg-background px-2 py-0.5 text-xs hover:border-primary">
                {a.name} <span className="text-muted-foreground">· {a.type}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Onglet Assets ─────────────────────────────────────────────────────────────

function AssetsTab({ projectId, assets, canManage, reload }: {
  projectId: number; assets: Asset[]; canManage: boolean; reload: () => Promise<void>;
}) {
  const view = useViewMode(`assets:${projectId}`);
  const favs = useFavorites((s) => s.favorites);
  const toggleFav = useFavorites((s) => s.toggle);
  const isFav = (id: number) => favs.some((f) => f.type === 'ASSET' && f.entityId === id);
  const [newAsset, setNewAsset] = useState({ name: '', type: 'CHARACTER' });
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [assigning, setAssigning] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post('/api/assets', { projectId, ...newAsset }); setNewAsset({ name: '', type: 'CHARACTER' }); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try { await api.del(`/api/assets/${deleting.id}`); setDeleting(null); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Assets réutilisables</h2>
        <ViewToggle contextKey={`assets:${projectId}`} />
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {canManage && (
        <form onSubmit={create} className="mb-5 flex gap-2 rounded-md border border-border bg-card p-2">
          <input className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-xs" placeholder="Nom de l'asset" value={newAsset.name} onChange={(e) => setNewAsset((s) => ({ ...s, name: e.target.value }))} required />
          <select className="rounded border border-input bg-background px-2 py-1.5 text-xs" value={newAsset.type} onChange={(e) => setNewAsset((s) => ({ ...s, type: e.target.value }))}>
            {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground"><Plus size={14} /> Asset</button>
        </form>
      )}
      {assets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun asset.</p>
      ) : (
        <EntityContainer view={view}>
          {assets.map((a) => (
            <EntityCard
              key={a.id}
              to={`/assets/${a.id}`}
              view={view}
              title={a.name}
              subtitle={a.type}
              thumbnailUrl={a.thumbnailUrl}
              actions={[
                { icon: <Star size={15} fill={isFav(a.id) ? 'currentColor' : 'none'} className={isFav(a.id) ? 'text-amber-400' : ''} />, label: 'Favori', onClick: () => toggleFav('ASSET', a.id) },
                ...(canManage ? [
                  { icon: <Link2 size={15} />, label: 'Assigner à des shots/séquences', onClick: () => setAssigning(a) },
                  { icon: DeleteIcon, label: 'Supprimer', danger: true, onClick: () => setDeleting(a) },
                ] : []),
              ]}
            />
          ))}
        </EntityContainer>
      )}
      {assigning && (
        <AssetAssignDialog
          assetId={assigning.id}
          projectId={projectId}
          assetName={assigning.name}
          onClose={() => setAssigning(null)}
          onSaved={reload}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Supprimer l'asset ?"
        message={<>L'asset « {deleting?.name} » et ses versions/médias seront déplacés dans la corbeille.</>}
        confirmLabel="Mettre à la corbeille"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// ── Onglet Membres ────────────────────────────────────────────────────────────

function MembersTab({ projectId }: { projectId: number }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [allUsers, setAllUsers] = useState<{ id: number; name: string | null; email: string }[]>([]);
  const [addUserId, setAddUserId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [{ project }, { users }] = await Promise.all([
      api.get<{ project: { memberships: Member[] } }>(`/api/projects/${projectId}`),
      api.get<{ users: { id: number; name: string | null; email: string }[] }>('/api/users'),
    ]);
    setMembers(project.memberships); setAllUsers(users);
  };
  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : 'Erreur')); }, [projectId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addUserId) return;
    try { await api.post(`/api/projects/${projectId}/members`, { userId: Number(addUserId) }); setAddUserId(''); load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };
  const remove = async (userId: number) => {
    try { await api.del(`/api/projects/${projectId}/members/${userId}`); load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };

  const memberIds = new Set(members.map((m) => m.user.id));
  const available = allUsers.filter((u) => !memberIds.has(u.id));

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground">Membres du projet</h2>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      <form onSubmit={add} className="mb-5 flex gap-2 rounded-md border border-border bg-card p-2">
        <select className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-sm" value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
          <option value="">Ajouter un utilisateur…</option>
          {available.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email} ({u.email})</option>)}
        </select>
        <button className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"><Plus size={14} /> Ajouter</button>
      </form>
      <div className="space-y-1.5">
        {members.map((m) => (
          <div key={m.user.id} className="group flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
            <div>
              <span className="text-sm font-medium">{m.user.name ?? m.user.email}</span>
              <span className="ml-2 text-xs text-muted-foreground">{m.user.email} · {m.user.role}</span>
            </div>
            <button onClick={() => remove(m.user.id)} title="Retirer" className="flex h-7 w-7 items-center justify-center rounded-md text-destructive opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100">
              {DeleteIcon}
            </button>
          </div>
        ))}
        {members.length === 0 && <p className="text-sm text-muted-foreground">Aucun membre assigné.</p>}
      </div>
    </div>
  );
}

// ── Onglet Corbeille ──────────────────────────────────────────────────────────

interface TrashData {
  sequences: { id: number; name: string; code: string }[];
  shots: { id: number; name: string; code: string }[];
  assets: { id: number; name: string; type: string }[];
  versions: { id: number; name: string }[];
  media: { id: number; originalName: string; kind: string }[];
}

function TrashTab({ projectId, reload }: { projectId: number; reload: () => Promise<void> }) {
  const [data, setData] = useState<TrashData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purge, setPurge] = useState<{ endpoint: string; label: string } | null>(null);

  const load = () => api.get<TrashData>(`/api/projects/${projectId}/trash`).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Erreur'));
  useEffect(() => { load(); }, [projectId]);

  const restore = async (endpoint: string) => {
    try { await api.post(`${endpoint}/restore`); load(); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };
  const confirmPurge = async () => {
    if (!purge) return;
    try { await api.del(`${purge.endpoint}/purge`); setPurge(null); load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };

  const Section = ({ title, items }: { title: string; items: { id: number; label: string; endpoint: string }[] }) => (
    items.length === 0 ? null : (
      <section className="mb-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.endpoint} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
              <span>{it.label}</span>
              <div className="flex gap-2">
                <button onClick={() => restore(it.endpoint)} className="rounded border border-border px-2 py-1 text-xs hover:bg-secondary/60">Restaurer</button>
                <button onClick={() => setPurge({ endpoint: it.endpoint, label: it.label })} className="rounded px-2 py-1 text-xs text-destructive hover:bg-secondary/60">Supprimer définitivement</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    )
  );

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  const isEmpty = !data.sequences.length && !data.shots.length && !data.assets.length && !data.versions.length && !data.media.length;

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground">Corbeille du projet</h2>
      {isEmpty && <p className="text-sm text-muted-foreground">La corbeille est vide.</p>}
      <Section title="Séquences" items={data.sequences.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}`, endpoint: `/api/sequences/${s.id}` }))} />
      <Section title="Shots" items={data.shots.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}`, endpoint: `/api/shots/${s.id}` }))} />
      <Section title="Assets" items={data.assets.map((a) => ({ id: a.id, label: `${a.name} (${a.type})`, endpoint: `/api/assets/${a.id}` }))} />
      <Section title="Versions" items={data.versions.map((v) => ({ id: v.id, label: v.name, endpoint: `/api/versions/${v.id}` }))} />
      <Section title="Médias" items={data.media.map((m) => ({ id: m.id, label: `${m.originalName} (${m.kind})`, endpoint: `/api/media/${m.id}` }))} />
      <ConfirmDialog
        open={!!purge}
        title="Supprimer définitivement ?"
        message={<>« {purge?.label} » sera supprimé de la base et du stockage. Cette action est irréversible.</>}
        confirmLabel="Supprimer définitivement"
        danger
        onConfirm={confirmPurge}
        onCancel={() => setPurge(null)}
      />
    </div>
  );
}
