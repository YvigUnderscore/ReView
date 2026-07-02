import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, LayoutDashboard, Users as UsersIcon, Activity, Settings as SettingsIcon, History, RefreshCw, Server, FolderCog, Save } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { useAuth, type Role } from '../stores/useAuth';
import Shell from '../components/Shell';
import Tabs from '../components/Tabs';
import ConfirmDialog from '../components/ConfirmDialog';
import MiniBarChart from '../components/MiniBarChart';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select } from '../components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { SkeletonRows } from '../components/ui/skeleton';

interface Stats {
  users: { total: number; byRole: Record<string, number>; online: number };
  pipeline: { projects: number; sequences: number; shots: number; assets: number; versions: number };
  media: { count: number; byKind: Record<string, number>; byStatus: Record<string, number>; storageBytes: number };
  comments: number;
  jobs: Record<string, number> | null;
  topStorageUsers: { id: number; name: string; storageUsed: number; storageLimit: number | null }[];
}
interface System {
  host: { platform: string; arch: string; nodeVersion: string; cpus: number; loadAvg: number[]; uptimeSec: number; processUptimeSec: number };
  memory: { total: number; free: number; used: number; processRss: number };
  disk: { total: number; free: number } | null;
  services: { database: boolean; redis: boolean; minio: boolean };
}
interface ActivityData {
  days: number;
  uploads: { day: string; count: number; bytes: number }[];
  signups: { day: string; count: number }[];
}
interface UserRow {
  id: number; email: string; name: string | null; firstName: string | null; lastName: string | null;
  username: string | null; displayName?: string; role: Role; storageUsed: number; storageLimit: number | null; online?: boolean;
}
interface AuditRow { id: number; action: string; entityType: string | null; entityId: number | null; createdAt: string; }
interface TrashProject { id: number; name: string; status: string; deletedAt: string; }
interface Nomenclature { sequencePrefix: string; shotPrefix: string; padding: number; step: number; }
interface Department { key: string; name: string; }
interface ProjectDefaults { departments: Department[]; nomenclature: Nomenclature; }

const SETTINGS_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: 'default_start_frame', label: 'Frame de départ par défaut', hint: 'ex. 1001 — appliqué aux nouveaux projets' },
  { key: 'max_file_size', label: 'Taille max fichier (octets)', hint: 'ex. 5368709120 = 5 Go' },
  { key: 'storage_limit_user', label: 'Quota stockage / utilisateur (octets)', hint: 'ex. 10737418240 = 10 Go' },
  { key: 'max_concurrent_uploads', label: 'Uploads simultanés max', hint: 'ex. 5' },
  { key: 'trash_retention_days', label: 'Rétention corbeille (jours)', hint: 'ex. 30 — 0 = purge auto désactivée' },
];
const ROLES: Role[] = ['ADMIN', 'SUPERVISOR', 'ARTIST', 'CLIENT'];
const fmtBytes = (b: number) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' Go' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' Mo' : (b / 1e3).toFixed(0) + ' Ko');
const fmtDuration = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}j ${h}h` : h > 0 ? `${h}h ${m}min` : `${m}min`;
};
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });

export default function AdminPage() {
  const me = useAuth((s) => s.user);
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [system, setSystem] = useState<System | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [projectDefaults, setProjectDefaults] = useState<ProjectDefaults | null>(null);
  const [trash, setTrash] = useState<TrashProject[]>([]);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserRow | null>(null);
  const [purgeProject, setPurgeProject] = useState<TrashProject | null>(null);

  const loadUsers = () => api.get<{ users: UserRow[] }>('/api/users').then((d) => setUsers(d.users));
  const loadTrash = () => api.get<{ projects: TrashProject[] }>('/api/admin/trash').then((d) => setTrash(d.projects));
  const loadSystem = () => api.get<System>('/api/admin/system').then(setSystem).catch(() => undefined);
  useEffect(() => {
    Promise.all([
      api.get<Stats>('/api/admin/stats').then(setStats),
      loadSystem(),
      api.get<ActivityData>('/api/admin/activity?days=30').then(setActivity).catch(() => undefined),
      loadUsers(),
      loadTrash(),
      api.get<{ logs: AuditRow[] }>('/api/studio/audit').then((d) => setAudit(d.logs)),
      api.get<{ settings: Record<string, string> }>('/api/studio/settings').then((d) => setSettings(d.settings)),
      api.get<{ settings: ProjectDefaults }>('/api/admin/project-defaults').then((d) => setProjectDefaults(d.settings)).catch(() => undefined),
    ]).catch((e) => setError(e instanceof Error ? e.message : 'Erreur'));
  }, []);

  const saveSetting = async (key: string) => {
    try { await api.put('/api/studio/settings', { key, value: settings[key] ?? '' }); setSavedKey(key); setTimeout(() => setSavedKey(null), 1500); }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };
  const confirmDeleteUser = async () => {
    if (!deletingUser) return;
    try { await api.del(`/api/users/${deletingUser.id}`); toast.success('Utilisateur supprimé'); setDeletingUser(null); loadUsers(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };
  const restoreProject = async (id: number) => {
    try { await api.post(`/api/projects/${id}/restore`); toast.success('Projet restauré'); loadTrash(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };
  const confirmPurgeProject = async () => {
    if (!purgeProject) return;
    try { await api.del(`/api/projects/${purgeProject.id}/purge`); toast.success('Projet supprimé définitivement'); setPurgeProject(null); loadTrash(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };
  const retryJobs = async () => {
    try { const { retried } = await api.post<{ retried: number }>('/api/admin/jobs/retry'); setInfo(`${retried} job(s) relancé(s).`); setTimeout(() => setInfo(null), 2500); }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };

  if (me?.role !== 'ADMIN') return <Shell><p className="text-sm text-destructive">Accès réservé aux administrateurs.</p></Shell>;

  const tabs = [
    { key: 'overview', label: "Tableau de bord", icon: <LayoutDashboard size={16} /> },
    { key: 'activity', label: 'Activité', icon: <Activity size={16} /> },
    { key: 'users', label: 'Utilisateurs', icon: <UsersIcon size={16} />, badge: users.length },
    { key: 'system', label: 'Système', icon: <Server size={16} /> },
    { key: 'settings', label: 'Réglages', icon: <SettingsIcon size={16} /> },
    { key: 'defaults', label: 'Défauts projet', icon: <FolderCog size={16} /> },
    { key: 'trash', label: 'Corbeille', icon: <Trash2 size={16} />, badge: trash.length },
    { key: 'audit', label: 'Audit', icon: <History size={16} /> },
  ];

  return (
    <Shell title="Administration">
      <h1 className="mb-4 text-xl font-semibold">Administration</h1>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {info && <p className="mb-3 text-sm text-green-400">{info}</p>}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && <OverviewTab stats={stats} system={system} onRetryJobs={retryJobs} />}
      {tab === 'activity' && <ActivityTab activity={activity} />}
      {tab === 'system' && <SystemTab system={system} onRefresh={loadSystem} />}
      {tab === 'users' && (
        <UsersTab
          users={users} meId={me.id}
          onCreate={() => setCreating(true)}
          onEdit={setEditingUser}
          onDelete={setDeletingUser}
        />
      )}
      {tab === 'settings' && (
        <SettingsTab settings={settings} savedKey={savedKey} onChange={(k, v) => setSettings((s) => ({ ...s, [k]: v }))} onSave={saveSetting} />
      )}
      {tab === 'defaults' && (
        <ProjectDefaultsTab defaults={projectDefaults} onChange={setProjectDefaults} />
      )}
      {tab === 'trash' && <TrashTab trash={trash} onRestore={restoreProject} onPurge={setPurgeProject} />}
      {tab === 'audit' && <AuditTab audit={audit} />}

      {creating && <UserModal title="Nouvel utilisateur" onClose={() => setCreating(false)} onSaved={() => { setCreating(false); loadUsers(); }} />}
      {editingUser && <UserModal title="Modifier l'utilisateur" user={editingUser} onClose={() => setEditingUser(null)} onSaved={() => { setEditingUser(null); loadUsers(); }} />}
      <ConfirmDialog
        open={!!deletingUser}
        title="Supprimer l'utilisateur ?"
        message={<>« {deletingUser?.displayName ?? deletingUser?.email} » sera définitivement supprimé.</>}
        confirmLabel="Supprimer" danger
        onConfirm={confirmDeleteUser} onCancel={() => setDeletingUser(null)}
      />
      <ConfirmDialog
        open={!!purgeProject}
        title="Supprimer définitivement le projet ?"
        message={<>« {purgeProject?.name} » et tous ses médias seront supprimés de la base et du stockage. Irréversible.</>}
        confirmLabel="Supprimer définitivement" danger
        onConfirm={confirmPurgeProject} onCancel={() => setPurgeProject(null)}
      />
    </Shell>
  );
}

// ── Tableau de bord ───────────────────────────────────────────────────────────

function OverviewTab({ stats, system, onRetryJobs }: { stats: Stats | null; system: System | null; onRetryJobs: () => void }) {
  if (!stats) return <SkeletonRows count={4} />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Metric label="Utilisateurs" value={stats.users.total} sub={`${stats.users.online} en ligne`} />
        <Metric label="Projets" value={stats.pipeline.projects} />
        <Metric label="Séquences" value={stats.pipeline.sequences} />
        <Metric label="Shots" value={stats.pipeline.shots} />
        <Metric label="Assets" value={stats.pipeline.assets} />
        <Metric label="Versions" value={stats.pipeline.versions} />
        <Metric label="Médias" value={stats.media.count} />
        <Metric label="Commentaires" value={stats.comments} />
        <Metric label="Stockage" value={fmtBytes(stats.media.storageBytes)} />
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
                <Button variant="outline" size="sm" className="mt-2" onClick={onRetryJobs}><RefreshCw size={13} /> Relancer les jobs en échec</Button>
              )}
            </>
          ) : <p className="text-xs text-muted-foreground">File indisponible.</p>}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top stockage / utilisateur">
          <div className="space-y-1.5">
            {stats.topStorageUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between text-sm">
                <span className="truncate">{u.name}</span>
                <span className="text-muted-foreground">{fmtBytes(u.storageUsed)}{u.storageLimit ? ` / ${fmtBytes(u.storageLimit)}` : ''}</span>
              </div>
            ))}
            {stats.topStorageUsers.length === 0 && <p className="text-xs text-muted-foreground">Aucune donnée.</p>}
          </div>
        </Panel>
        <Panel title="Santé des services">
          {system ? <ServiceHealth services={system.services} /> : <SkeletonRows count={2} />}
        </Panel>
      </div>
    </div>
  );
}

function ServiceHealth({ services }: { services: System['services'] }) {
  const items: [string, boolean][] = [['PostgreSQL', services.database], ['Redis', services.redis], ['MinIO', services.minio]];
  return (
    <div className="space-y-1.5">
      {items.map(([name, ok]) => (
        <div key={name} className="flex items-center justify-between text-sm">
          <span>{name}</span>
          <span className={`flex items-center gap-1.5 text-xs ${ok ? 'text-green-400' : 'text-destructive'}`}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: ok ? '#22c55e' : '#ef4444' }} />
            {ok ? 'OK' : 'Hors service'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Activité ──────────────────────────────────────────────────────────────────

function ActivityTab({ activity }: { activity: ActivityData | null }) {
  if (!activity) return <SkeletonRows count={5} />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={`Uploads / jour (${activity.days} j)`}>
        <MiniBarChart data={activity.uploads.map((u) => ({ label: dayLabel(u.day), value: u.count }))} />
      </Panel>
      <Panel title={`Octets uploadés / jour (${activity.days} j)`}>
        <MiniBarChart data={activity.uploads.map((u) => ({ label: dayLabel(u.day), value: u.bytes }))} color="#22c55e" valueFormat={fmtBytes} />
      </Panel>
      <Panel title={`Nouveaux comptes / jour (${activity.days} j)`}>
        <MiniBarChart data={activity.signups.map((u) => ({ label: dayLabel(u.day), value: u.count }))} color="#f59e0b" />
      </Panel>
    </div>
  );
}

// ── Système ───────────────────────────────────────────────────────────────────

function SystemTab({ system, onRefresh }: { system: System | null; onRefresh: () => void }) {
  if (!system) return <SkeletonRows count={3} />;
  const memPct = Math.round((system.memory.used / system.memory.total) * 100);
  const diskPct = system.disk ? Math.round(((system.disk.total - system.disk.free) / system.disk.total) * 100) : null;
  return (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw size={13} /> Rafraîchir</Button>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Hôte">
          <dl className="space-y-1 text-sm">
            <Row k="Plateforme" v={`${system.host.platform} (${system.host.arch})`} />
            <Row k="Node.js" v={system.host.nodeVersion} />
            <Row k="CPU" v={`${system.host.cpus} cœurs`} />
            <Row k="Charge (1/5/15 min)" v={system.host.loadAvg.map((l) => l.toFixed(2)).join(' / ')} />
            <Row k="Uptime machine" v={fmtDuration(system.host.uptimeSec)} />
            <Row k="Uptime process" v={fmtDuration(system.host.processUptimeSec)} />
          </dl>
        </Panel>
        <Panel title="Ressources">
          <div className="space-y-3">
            <Gauge label={`Mémoire — ${fmtBytes(system.memory.used)} / ${fmtBytes(system.memory.total)}`} pct={memPct} />
            {diskPct !== null && system.disk && (
              <Gauge label={`Disque — ${fmtBytes(system.disk.total - system.disk.free)} / ${fmtBytes(system.disk.total)}`} pct={diskPct} />
            )}
            <Row k="RSS process" v={fmtBytes(system.memory.processRss)} />
          </div>
        </Panel>
      </div>
      <Panel title="Santé des services"><ServiceHealth services={system.services} /></Panel>
    </div>
  );
}

function Gauge({ label, pct }: { label: string; pct: number }) {
  const color = pct > 90 ? '#ef4444' : pct > 75 ? '#f59e0b' : '#22c55e';
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span>{pct}%</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>
);

// ── Utilisateurs ──────────────────────────────────────────────────────────────

function UsersTab({ users, meId, onCreate, onEdit, onDelete }: {
  users: UserRow[]; meId: number; onCreate: () => void; onEdit: (u: UserRow) => void; onDelete: (u: UserRow) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Comptes utilisateurs</h2>
        <Button size="sm" onClick={onCreate}><Plus size={14} /> Nouvel utilisateur</Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2">Utilisateur</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Rôle</th><th className="px-3 py-2">Stockage</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <span className="font-medium">{u.displayName ?? u.name ?? '—'}</span>
                  {u.online && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-green-500" title="En ligne" />}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                <td className="px-3 py-2"><Badge variant="secondary">{u.role}</Badge></td>
                <td className="px-3 py-2 text-muted-foreground">{fmtBytes(u.storageUsed)}{u.storageLimit ? ` / ${fmtBytes(u.storageLimit)}` : ''}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => onEdit(u)} title="Modifier" className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"><Pencil size={15} /></button>
                    {u.id !== meId && <button onClick={() => onDelete(u)} title="Supprimer" className="rounded p-1 text-destructive hover:bg-secondary"><Trash2 size={15} /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserModal({ title, user, onClose, onSaved }: { title: string; user?: UserRow; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!user;
  const [form, setForm] = useState({
    email: user?.email ?? '', password: '', firstName: user?.firstName ?? '', lastName: user?.lastName ?? '',
    username: user?.username ?? '', role: (user?.role ?? 'ARTIST') as Role,
    storageLimitGo: user?.storageLimit ? String((user.storageLimit / 1e9).toFixed(0)) : '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        email: form.email,
        firstName: form.firstName || null,
        lastName: form.lastName || null,
        username: form.username || null,
        role: form.role,
      };
      if (form.password) body.password = form.password;
      if (form.storageLimitGo) body.storageLimit = Math.round(Number(form.storageLimitGo) * 1e9);
      if (isEdit) {
        await api.patch(`/api/users/${user!.id}`, body);
        toast.success('Utilisateur modifié');
      } else {
        if (!form.password) throw new Error('Mot de passe requis');
        await api.post('/api/users', body);
        toast.success('Utilisateur créé');
      }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-3">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Prénom" value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
          <Input placeholder="Nom" value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
        </div>
        <Input placeholder="Pseudo (affiché)" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
        <Input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
        <Input type="password" placeholder={isEdit ? 'Nouveau mot de passe (laisser vide)' : 'Mot de passe (8+ car., lettres + chiffres)'} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required={!isEdit} />
        <div className="grid grid-cols-2 gap-2">
          <Select className="w-full" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
          <Input type="number" placeholder="Quota (Go)" value={form.storageLimitGo} onChange={(e) => setForm((f) => ({ ...f, storageLimitGo: e.target.value }))} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button type="submit" size="sm" disabled={busy}>{isEdit ? 'Enregistrer' : 'Créer'}</Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Réglages / Corbeille / Audit ──────────────────────────────────────────────

function SettingsTab({ settings, savedKey, onChange, onSave }: {
  settings: Record<string, string>; savedKey: string | null; onChange: (k: string, v: string) => void; onSave: (k: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      {SETTINGS_FIELDS.map((f) => (
        <div key={f.key} className="flex flex-wrap items-center gap-2 text-sm">
          <label className="w-64 text-muted-foreground">{f.label}</label>
          <Input className="flex-1 text-xs py-1" placeholder={f.hint} value={settings[f.key] ?? ''} onChange={(e) => onChange(f.key, e.target.value)} />
          <Button variant="outline" size="sm" onClick={() => onSave(f.key)}>
            {savedKey === f.key ? '✓ Enregistré' : 'Enregistrer'}
          </Button>
        </div>
      ))}
    </div>
  );
}

// Défauts de création de projet : nomenclature + départements (overridables par projet)
function ProjectDefaultsTab({ defaults, onChange }: { defaults: ProjectDefaults | null; onChange: (d: ProjectDefaults) => void }) {
  const [draft, setDraft] = useState<ProjectDefaults | null>(defaults);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (defaults && !draft) setDraft(defaults);
  if (!draft) return <SkeletonRows count={3} />;

  const setNom = (k: keyof Nomenclature, v: string) =>
    setDraft((d) => d && { ...d, nomenclature: { ...d.nomenclature, [k]: k === 'padding' || k === 'step' ? Number(v) || 1 : v } });
  const setDept = (i: number, k: keyof Department, v: string) =>
    setDraft((d) => d && { ...d, departments: d.departments.map((dep, idx) => (idx === i ? { ...dep, [k]: v } : dep)) });
  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try { const { settings } = await api.put<{ settings: ProjectDefaults }>('/api/admin/project-defaults', draft); onChange(settings); setDraft(settings); setMsg('Défauts enregistrés.'); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-muted-foreground">Valeurs appliquées à la création d'un projet et utilisées comme repli. Chaque projet peut les surcharger dans son onglet « Réglages ».</p>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {msg && <p className="text-sm text-green-400">{msg}</p>}

      <Panel title="Nomenclature par défaut">
        <div className="flex flex-wrap items-end gap-3">
          <DefField label="Préfixe séquence"><Input className="w-24 text-xs py-1.5" value={draft.nomenclature.sequencePrefix} onChange={(e) => setNom('sequencePrefix', e.target.value)} /></DefField>
          <DefField label="Préfixe shot"><Input className="w-24 text-xs py-1.5" value={draft.nomenclature.shotPrefix} onChange={(e) => setNom('shotPrefix', e.target.value)} /></DefField>
          <DefField label="Pas"><Input type="number" min={1} className="w-16 text-xs py-1.5" value={String(draft.nomenclature.step)} onChange={(e) => setNom('step', e.target.value)} /></DefField>
          <DefField label="Chiffres"><Input type="number" min={1} max={8} className="w-16 text-xs py-1.5" value={String(draft.nomenclature.padding)} onChange={(e) => setNom('padding', e.target.value)} /></DefField>
        </div>
      </Panel>

      <Panel title="Départements par défaut">
        <div className="space-y-1.5">
          {draft.departments.map((dep, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="w-32 text-xs py-1.5" placeholder="Clé" value={dep.key} onChange={(e) => setDept(i, 'key', e.target.value)} />
              <Input className="flex-1 text-xs py-1.5" placeholder="Nom" value={dep.name} onChange={(e) => setDept(i, 'name', e.target.value)} />
              <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setDraft((d) => d && { ...d, departments: d.departments.filter((_, idx) => idx !== i) })}><Trash2 size={14} /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="mt-1" onClick={() => setDraft((d) => d && { ...d, departments: [...d.departments, { key: '', name: '' }] })}><Plus size={14} /> Département</Button>
        </div>
      </Panel>

      <Button onClick={save} disabled={busy}><Save size={15} /> {busy ? 'Enregistrement…' : 'Enregistrer les défauts'}</Button>
    </div>
  );
}

function DefField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}{children}</label>;
}

function TrashTab({ trash, onRestore, onPurge }: { trash: TrashProject[]; onRestore: (id: number) => void; onPurge: (p: TrashProject) => void }) {
  if (trash.length === 0) return <p className="text-sm text-muted-foreground">Aucun projet en corbeille.</p>;
  return (
    <div className="space-y-1.5">
      {trash.map((p) => (
        <div key={p.id} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
          <span>{p.name} <span className="text-xs text-muted-foreground">· supprimé le {new Date(p.deletedAt).toLocaleDateString()}</span></span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onRestore(p.id)}>Restaurer</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onPurge(p)}>Supprimer définitivement</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditTab({ audit }: { audit: AuditRow[] }) {
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {audit.map((a) => (
        <li key={a.id}>
          <span className="text-foreground">{a.action}</span> {a.entityType ?? ''} {a.entityId ?? ''} · {new Date(a.createdAt).toLocaleString()}
        </li>
      ))}
      {audit.length === 0 && <li>Aucune entrée.</li>}
    </ul>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] text-primary">{sub}</div>}
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}
function DistList({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">Aucune donnée.</p>;
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{k}</span>
          <span className="font-medium">{v}</span>
        </div>
      ))}
    </div>
  );
}
