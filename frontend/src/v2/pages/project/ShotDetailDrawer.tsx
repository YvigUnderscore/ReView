import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useAssetsQuery } from '../../lib/queries';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { SkeletonRows } from '../../components/ui/skeleton';
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL } from '../../lib/taskStatus';
import { ASSET_TYPES, TASK_TYPES, type AssetRef, type Shot, type Task } from './projectTypes';

/**
 * Détail d'un shot en drawer latéral (10.C1) : miniature, tâches (avec accès
 * direct à la review du dernier média), assets rattachés. Ouverture pilotée par
 * l'URL (?tab=shots&shot=ID) — back/forward et partage de lien cohérents.
 */
export default function ShotDetailDrawer({ shot, projectId, canManage, onClose, reload }: {
  shot: Shot | null; projectId: number; canManage: boolean;
  onClose: () => void; reload: () => Promise<void>;
}) {
  return (
    <Sheet open={!!shot} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent>
        {shot && (
          <>
            <SheetHeader>
              <SheetTitle>{shot.code} · {shot.name}</SheetTitle>
              {shot.thumbnailUrl && (
                <img src={shot.thumbnailUrl} alt="" className="mt-2 h-36 w-full rounded-md border border-border object-cover" />
              )}
            </SheetHeader>
            <SheetBody>
              <ShotTasks shotId={shot.id} canManage={canManage} />
              <ShotAssets shotId={shot.id} projectId={projectId} canManage={canManage} reload={reload} />
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ShotTasks({ shotId, canManage }: { shotId: number; canManage: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: qk.tasks(shotId),
    queryFn: () => api.get<{ tasks: Task[] }>(`/api/tasks?shotId=${shotId}`).then((d) => d.tasks),
  });
  const tasks = isError ? [] : (data ?? null);
  const [task, setTask] = useState({ name: '', type: 'ANIMATION' });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.name.trim()) return;
    try {
      await api.post('/api/tasks', { shotId, ...task });
      toast.success(`Tâche « ${task.name} » créée`);
      setTask({ name: '', type: 'ANIMATION' });
      qc.invalidateQueries({ queryKey: qk.tasks(shotId) });
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erreur à la création de la tâche'); }
  };

  // Ouvre la review du média le plus récent de la tâche (version la plus récente d'abord).
  const openReview = async (taskId: number) => {
    try {
      const { versions } = await api.get<{ versions: { id: number }[] }>(`/api/versions?taskId=${taskId}`);
      for (const v of versions) {
        const { version } = await api.get<{ version: { media: { id: number }[] } }>(`/api/versions/${v.id}`);
        if (version.media.length > 0) { navigate(`/review/${version.media[0].id}`); return; }
      }
      toast.info('Aucun média à reviewer dans cette tâche');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erreur'); }
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Tâches {tasks && <span className="normal-case">· {tasks.length}</span>}
      </h3>
      {tasks === null ? (
        <SkeletonRows count={2} />
      ) : (
        <ul className="space-y-1">
          {tasks.length ? tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1.5">
              <Link to={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-primary">
                {t.name} <span className="text-xs text-muted-foreground">({t.type})</span>
              </Link>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${TASK_STATUS_COLOR[t.status] ?? ''}`}>{TASK_STATUS_LABEL[t.status] ?? t.status}</span>
              <button
                onClick={() => openReview(t.id)}
                title="Ouvrir la review du dernier média"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-primary"
              >
                <Play size={14} />
              </button>
            </li>
          )) : <li className="px-2 py-1 text-xs text-muted-foreground">Aucune tâche pour l’instant.</li>}
        </ul>
      )}
      {canManage && (
        <form onSubmit={submit} className="mt-2 flex gap-2">
          <input className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs" placeholder="Nouvelle tâche…" value={task.name} onChange={(e) => setTask((s) => ({ ...s, name: e.target.value }))} />
          <select className="rounded border border-input bg-background px-1 py-1 text-xs" value={task.type} onChange={(e) => setTask((s) => ({ ...s, type: e.target.value }))}>
            {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">+ Tâche</button>
        </form>
      )}
    </section>
  );
}

// Assets rattachés au shot : lister, détacher, rattacher un existant, créer + rattacher
function ShotAssets({ shotId, projectId, canManage, reload }: {
  shotId: number; projectId: number; canManage: boolean; reload: () => Promise<void>;
}) {
  const qc = useQueryClient();
  const shotQ = useQuery({
    queryKey: qk.shot(shotId),
    queryFn: () => api.get<{ shot: { assets: AssetRef[] } }>(`/api/shots/${shotId}`),
  });
  const assets = shotQ.isError ? [] : (shotQ.data?.shot.assets ?? null);
  const allAssets: AssetRef[] = useAssetsQuery(projectId).data ?? [];
  const [pick, setPick] = useState('');
  const [creating, setCreating] = useState({ name: '', type: 'CHARACTER' });
  const [showCreate, setShowCreate] = useState(false);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.shot(shotId) }),
      qc.invalidateQueries({ queryKey: qk.assets(projectId) }),
    ]);
    reload();
  };
  const linkExisting = async () => {
    if (!pick) return;
    await api.post(`/api/shots/${shotId}/assets`, { assetId: Number(pick) });
    toast.success('Asset rattaché au shot');
    setPick(''); await refresh();
  };
  const createAndLink = async () => {
    if (!creating.name.trim()) return;
    await api.post(`/api/shots/${shotId}/assets`, { name: creating.name, type: creating.type });
    toast.success(`Asset « ${creating.name} » créé et rattaché`);
    setCreating({ name: '', type: 'CHARACTER' }); setShowCreate(false); await refresh();
  };
  const detach = async (assetId: number) => {
    await api.del(`/api/shots/${shotId}/assets/${assetId}`);
    toast.success('Asset détaché');
    await refresh();
  };

  const linkedIds = new Set((assets ?? []).map((a) => a.id));
  const available = allAssets.filter((a) => !linkedIds.has(a.id));

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assets du shot</h3>
      {assets === null ? (
        <SkeletonRows count={1} />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {assets.length === 0 && <span className="text-xs text-muted-foreground">Aucun asset rattaché.</span>}
          {assets.map((a) => (
            <span key={a.id} className="flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-xs">
              <Link to={`/assets/${a.id}`} className="hover:text-primary">{a.name} <span className="text-muted-foreground">· {a.type}</span></Link>
              {canManage && <button onClick={() => detach(a.id)} title="Détacher" className="text-muted-foreground hover:text-destructive">×</button>}
            </span>
          ))}
        </div>
      )}
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
    </section>
  );
}
