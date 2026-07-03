import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileVideo, Layers, Clock } from 'lucide-react';
import { api } from '../../lib/apiClient';
import {
  TASK_STATUSES as STATUS,
  TASK_STATUS_LABEL as STATUS_LABEL,
  TASK_STATUS_COLOR as STATUS_COLOR,
  TASK_STATUS_BAR as STATUS_BAR,
  TASK_STATUS_PRIORITY as PRIORITY,
} from '../lib/taskStatus';

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

  // Répartition des tâches par statut (jauge de progression — 10.C1) ;
  // suit les mises à jour optimistes de statut ci-dessous.
  const byStatus = STATUS.map((s) => ({ status: s, count: tasks.filter((t) => t.status === s).length }));
  const total = tasks.length;

  return (
    <div className="mt-6 space-y-4">
      {total > 0 && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Progression des tâches</h3>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-secondary/40">
            {byStatus.filter((b) => b.count > 0).map((b) => (
              <div
                key={b.status}
                title={`${STATUS_LABEL[b.status]} : ${b.count}`}
                className={`${STATUS_BAR[b.status] ?? 'bg-muted-foreground/40'} transition-all`}
                style={{ width: `${(b.count / total) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {byStatus.filter((b) => b.count > 0).map((b) => (
              <span key={b.status} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${STATUS_BAR[b.status] ?? 'bg-muted-foreground/40'}`} />
                {STATUS_LABEL[b.status]} · {b.count}
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
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
    </div>
  );
}
