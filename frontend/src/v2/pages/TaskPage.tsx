import { useEffect, useState, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, LayoutGrid, List, Trash2, Upload, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { useAuth } from '../stores/useAuth';
import { useUploadStore } from '../../stores/useUploadStore';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL } from '../lib/taskStatus';

interface Media { id: number; kind: string; originalName: string; status: string; published: boolean; }
interface Version { id: number; name: string; status: string; published: boolean; createdAt?: string; author?: { id: number; name: string | null } | null; media?: Media[]; _count?: { media: number }; }
interface TaskCtx {
  id: number; name: string; type: string; status: string;
  shot?: { id: number; code: string; name: string; project: { id: number; name: string }; sequence?: { id: number; code: string; name: string } | null } | null;
  asset?: { id: number; name: string; type: string; project: { id: number; name: string } } | null;
}

export default function TaskPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const role = useAuth((s) => s.user?.role);
  const canCreate = role !== 'CLIENT';
  const canPublish = role === 'ADMIN' || role === 'SUPERVISOR';
  const enqueue = useUploadStore((s) => s.enqueue);
  const uploads = useUploadStore((s) => s.uploads);
  const [task, setTask] = useState<TaskCtx | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cardMode, setCardMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteVersion, setDeleteVersion] = useState<Version | null>(null);
  const [deleteMedia, setDeleteMedia] = useState<Media | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<number | null>(null);

  const loadContext = () => api.get<{ task: TaskCtx }>(`/api/tasks/${taskId}`).then((d) => setTask(d.task)).catch((e) => setError(e.message));
  const load = () =>
    api.get<{ versions: Version[] }>(`/api/versions?taskId=${taskId}`)
      .then((d) => {
        setVersions(d.versions);
        // Ouvre la dernière version par défaut (liste triée du plus récent au plus ancien)
        setSelectedId((cur) => (cur && d.versions.some((v) => v.id === cur) ? cur : d.versions[0]?.id ?? null));
      })
      .catch((e) => setError(e.message));
  useEffect(() => { loadContext(); load(); }, [taskId]);
  useEffect(() => { if (uploads.some((u) => u.status === 'done')) load(); }, [uploads]);

  const openMedia = async (versionId: number) => {
    const { version } = await api.get<{ version: Version }>(`/api/versions/${versionId}`);
    setVersions((vs) => vs.map((v) => (v.id === versionId ? { ...v, media: version.media } : v)));
  };

  // Charge les médias d'une version dès qu'elle est sélectionnée (et pas encore chargés)
  useEffect(() => {
    if (selectedId == null) return;
    const v = versions.find((x) => x.id === selectedId);
    if (v && !v.media) openMedia(selectedId);
  }, [selectedId, versions]);

  const createVersion = async () => {
    try {
      const { version } = await api.post<{ version: Version }>('/api/versions', { taskId });
      toast.success(`Version « ${version.name} » créée`);
      await load(); setSelectedId(version.id);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };
  const publish = async (vid: number) => {
    try { await api.patch(`/api/versions/${vid}`, { status: 'PUBLISHED' }); toast.success('Version publiée'); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };
  const publishMedia = async (versionId: number, mediaId: number) => {
    try { await api.post(`/api/media/${mediaId}/publish`); toast.success('Média publié pour l’équipe'); openMedia(versionId); }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };
  const confirmDeleteVersion = async () => {
    if (!deleteVersion) return;
    try { await api.del(`/api/versions/${deleteVersion.id}`); toast.success('Version déplacée dans la corbeille'); setDeleteVersion(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };
  const confirmDeleteMedia = async () => {
    if (!deleteMedia) return;
    try { await api.del(`/api/media/${deleteMedia.id}`); toast.success('Média déplacé dans la corbeille'); const vid = selectedId; setDeleteMedia(null); if (vid) openMedia(vid); }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && target) enqueue(file, target);
    if (fileRef.current) fileRef.current.value = '';
  };

  // Fil d'ariane de localisation
  const project = task?.shot?.project ?? task?.asset?.project;
  const selected = versions.find((v) => v.id === selectedId) ?? null;

  return (
    <Shell title={task?.name ?? 'Tâche'} breadcrumb={<EntityBreadcrumb entity="task" id={taskId} />}>
      {/* En-tête : localisation claire au lieu de « Tâche #id » */}
      <div className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {project && <Link to={`/projects/${project.id}`} className="hover:text-foreground">{project.name}</Link>}
        {task?.shot && (
          <>
            <ChevronRight size={12} />
            <Link to={`/projects/${task.shot.project.id}?tab=shots&shot=${task.shot.id}`} className="hover:text-foreground">
              {task.shot.sequence ? `${task.shot.sequence.code} · ` : ''}{task.shot.code}
            </Link>
          </>
        )}
        {task?.asset && (
          <>
            <ChevronRight size={12} />
            <Link to={`/assets/${task.asset.id}`} className="hover:text-foreground">{task.asset.name}</Link>
          </>
        )}
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{task?.name ?? `Tâche #${taskId}`}</h1>
          {task && <Badge variant="secondary">{task.type}</Badge>}
          {task && <span className={`rounded px-2 py-0.5 text-xs ${TASK_STATUS_COLOR[task.status] ?? ''}`}>{TASK_STATUS_LABEL[task.status] ?? task.status}</span>}
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button size="sm" onClick={createVersion}>+ Nouvelle version</Button>
          )}
          <div className="flex overflow-hidden rounded-md border border-border">
            <button onClick={() => setCardMode(false)} title="Vue détaillée" className={`px-2 py-1.5 ${!cardMode ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'}`}><List size={15} /></button>
            <button onClick={() => setCardMode(true)} title="Vue cartes" className={`px-2 py-1.5 ${cardMode ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'}`}><LayoutGrid size={15} /></button>
          </div>
        </div>
      </div>
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      <input ref={fileRef} type="file" className="hidden" onChange={onFile} />

      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune version.{canCreate ? ' Créez-en une ci-dessus.' : ''}</p>
      ) : cardMode ? (
        // ── Mode cartes : toutes les versions en grille compacte ──────────────
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => { setSelectedId(v.id); setCardMode(false); }}
              className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary"
            >
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold">{v.name}</span>
                {v.published ? <CheckCircle2 size={16} className="text-green-400" /> : <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">Brouillon</span>}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{v._count?.media ?? 0} média(s)</div>
              {v.author?.name && <div className="text-[11px] text-muted-foreground">par {v.author.name}</div>}
            </button>
          ))}
        </div>
      ) : (
        // ── Mode détaillé : sélecteur de versions + version courante ───────────
        <div className="flex flex-col gap-4 lg:flex-row">
          <aside className="flex shrink-0 gap-2 overflow-x-auto lg:w-40 lg:flex-col lg:overflow-visible">
            {versions.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedId(v.id)}
                className={`flex shrink-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                  v.id === selectedId ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary/60'
                }`}
              >
                <span className="font-medium">{v.name}</span>
                {v.published ? <CheckCircle2 size={14} className="text-green-400" /> : <span className="h-2 w-2 rounded-full bg-amber-400" title="Brouillon" />}
              </button>
            ))}
          </aside>

          {selected && (
            <div className="min-w-0 flex-1 rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">{selected.name}</span>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">{selected.status}</span>
                  {selected.published && <span className="text-xs text-green-400">publié</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canCreate && (
                    <Button size="sm" variant="outline" onClick={() => { setTarget(selected.id); fileRef.current?.click(); }}>
                      <Upload size={13} /> Uploader un média
                    </Button>
                  )}
                  {canPublish && !selected.published && (
                    <Button size="sm" variant="outline" onClick={() => publish(selected.id)}>Publier la version</Button>
                  )}
                  {canCreate && (
                    <Button size="sm" variant="outline" onClick={() => setDeleteVersion(selected)} className="text-destructive hover:text-destructive">
                      <Trash2 size={13} /> Supprimer
                    </Button>
                  )}
                </div>
              </div>

              {selected.media ? (
                <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {selected.media.map((m) => (
                    <li key={m.id} className="group relative rounded border border-border p-2 text-xs">
                      <Link to={`/review/${m.id}`} className="block hover:text-primary">
                        <div className="truncate pr-5">{m.originalName}</div>
                        <div className="text-muted-foreground">
                          {m.kind} · {m.status}
                          {!m.published && <span className="ml-1 rounded bg-amber-500/20 px-1 text-amber-300">Brouillon</span>}
                        </div>
                      </Link>
                      {canCreate && (
                        <button onClick={() => setDeleteMedia(m)} title="Supprimer le média" className="absolute right-1 top-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100">
                          <Trash2 size={13} />
                        </button>
                      )}
                      {!m.published && (
                        <button onClick={() => publishMedia(selected.id, m.id)} className="mt-1 w-full rounded border border-border px-1 py-0.5 text-[10px] hover:bg-muted">
                          Publier le média
                        </button>
                      )}
                    </li>
                  ))}
                  {selected.media.length === 0 && <li className="text-xs text-muted-foreground">Aucun média</li>}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">Chargement des médias…</p>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteVersion}
        title="Supprimer la version ?"
        message={<>La version « {deleteVersion?.name} » et ses médias seront déplacés dans la corbeille du projet.</>}
        confirmLabel="Mettre à la corbeille"
        danger
        onConfirm={confirmDeleteVersion}
        onCancel={() => setDeleteVersion(null)}
      />
      <ConfirmDialog
        open={!!deleteMedia}
        title="Supprimer le média ?"
        message={<>« {deleteMedia?.originalName} » sera déplacé dans la corbeille du projet.</>}
        confirmLabel="Mettre à la corbeille"
        danger
        onConfirm={confirmDeleteMedia}
        onCancel={() => setDeleteMedia(null)}
      />
    </Shell>
  );
}
