import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileVideo, Layers, Clock } from 'lucide-react';
import { api } from '../../lib/apiClient';

interface RecentItem {
  type: 'version' | 'media'; id: number; at: string; label: string;
  location: string; author: string | null; kind?: string;
  taskId?: number | null; mediaId?: number; versionId?: number;
}
interface ActTask {
  id: number; name: string; type: string; status: string;
  assignee: { id: number; name: string | null } | null; location: string;
}
interface Member { user: { id: number; name: string | null; email: string } }

const STATUS = ['TODO', 'IN_PROGRESS', 'PENDING_REVIEW', 'RETAKE', 'REJECTED', 'APPROVED'];
const STATUS_LABEL: Record<string, string> = {
  TODO: 'À faire', IN_PROGRESS: 'En cours', PENDING_REVIEW: 'À review',
  RETAKE: 'Retake', REJECTED: 'Rejeté', APPROVED: 'Approuvé',
};
const STATUS_COLOR: Record<string, string> = {
  TODO: 'bg-muted text-muted-foreground',
  IN_PROGRESS: 'bg-blue-500/20 text-blue-300',
  PENDING_REVIEW: 'bg-amber-500/20 text-amber-300',
  APPROVED: 'bg-green-500/20 text-green-300',
  REJECTED: 'bg-red-500/20 text-red-300',
  RETAKE: 'bg-orange-500/20 text-orange-300',
};
// Priorité décroissante : ce qui demande une action remonte en haut.
const PRIORITY: Record<string, number> = { RETAKE: 0, REJECTED: 1, PENDING_REVIEW: 2, IN_PROGRESS: 3, TODO: 4, APPROVED: 5 };

export default function ProjectActivity({ projectId, canManage }: { projectId: number; canManage: boolean }) {
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [tasks, setTasks] = useState<ActTask[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api.get<{ recent: RecentItem[]; tasks: ActTask[] }>(`/api/projects/${projectId}/activity`)
      .then((d) => { setRecent(d.recent); setTasks([...d.tasks].sort((a, b) => (PRIORITY[a.status] ?? 9) - (PRIORITY[b.status] ?? 9))); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Erreur'));
  useEffect(() => {
    load();
    if (canManage) {
      api.get<{ project: { memberships: Member[] } }>(`/api/projects/${projectId}`)
        .then((d) => setMembers(d.project.memberships)).catch(() => undefined);
    }
  }, [projectId, canManage]);

  const setStatus = async (taskId: number, status: string) => {
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try { await api.patch(`/api/tasks/${taskId}`, { status }); } catch { load(); }
  };
  const assign = async (taskId: number, assigneeId: string) => {
    const id = assigneeId ? Number(assigneeId) : null;
    const member = members.find((m) => m.user.id === id);
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, assignee: id ? { id: id!, name: member?.user.name ?? null } : null } : t)));
    try { await api.patch(`/api/tasks/${taskId}`, { assigneeId: id }); } catch { load(); }
  };

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      {/* Dernières mises à jour */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Clock size={15} /> Dernières mises à jour</h3>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucune activité récente.</p>
        ) : (
          <ul className="space-y-1.5">
            {recent.map((r) => {
              const to = r.type === 'media' ? `/review/${r.mediaId}` : r.taskId ? `/tasks/${r.taskId}` : '#';
              return (
                <li key={`${r.type}-${r.id}`}>
                  <Link to={to} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary/60">
                    {r.type === 'media' ? <FileVideo size={14} className="shrink-0 text-primary" /> : <Layers size={14} className="shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">
                      {r.location && <span className="text-muted-foreground">{r.location} · </span>}
                      <span className="font-medium">{r.label}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{new Date(r.at).toLocaleDateString()}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Tâches à traiter (priorité par statut) + statut/assignation */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Layers size={15} /> Tâches à traiter</h3>
        {tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucune tâche.</p>
        ) : (
          <ul className="space-y-1.5">
            {tasks.slice(0, 25).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs">
                <Link to={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate hover:text-primary">
                  {t.location && <span className="text-muted-foreground">{t.location} · </span>}
                  <span className="font-medium">{t.name}</span>
                </Link>
                {canManage ? (
                  <>
                    <select value={t.status} onChange={(e) => setStatus(t.id, e.target.value)} className={`rounded px-1 py-0.5 text-[11px] ${STATUS_COLOR[t.status] ?? ''}`}>
                      {STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                    <select value={t.assignee?.id ?? ''} onChange={(e) => assign(t.id, e.target.value)} className="rounded border border-input bg-background px-1 py-0.5 text-[11px]">
                      <option value="">Non assigné</option>
                      {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name ?? m.user.email}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_COLOR[t.status] ?? ''}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
                    {t.assignee && <span className="text-[11px] text-muted-foreground">{t.assignee.name}</span>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
