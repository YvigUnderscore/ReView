import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useShotsQuery } from '../lib/queries';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import { TASK_STATUSES, TASK_STATUS_LABEL } from '../lib/taskStatus';
import type { TaskStatus, TaskWithAssignee } from '../types/api';

type BoardTask = TaskWithAssignee & { shotId: number; shotCode: string };

const COLUMNS = TASK_STATUSES.map((key) => ({ key, label: TASK_STATUS_LABEL[key] }));

export default function KanbanPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  const shotsQ = useShotsQuery(projectId);
  const shots = shotsQ.data ?? [];
  const taskQueries = useQueries({
    queries: shots.map((s) => ({
      queryKey: qk.tasks(s.id),
      queryFn: () => api.get<{ tasks: TaskWithAssignee[] }>(`/api/tasks?shotId=${s.id}`).then((d) => d.tasks),
    })),
  });
  const tasks: BoardTask[] = shots.flatMap((s, i) =>
    (taskQueries[i]?.data ?? []).map((t) => ({ ...t, shotId: s.id, shotCode: s.code })));
  const loadError = (shotsQ.error ?? taskQueries.find((q) => q.error)?.error)?.message ?? null;

  // Déplacement optimiste dans le cache du shot concerné ; rollback par invalidation.
  const move = async (taskId: number, status: TaskStatus) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t || t.status === status) return;
    const key = qk.tasks(t.shotId);
    qc.setQueryData<TaskWithAssignee[]>(key, (old) => old?.map((x) => (x.id === taskId ? { ...x, status } : x)));
    try { await api.patch(`/api/tasks/${taskId}`, { status }); }
    catch (e) { qc.invalidateQueries({ queryKey: key }); setError(e instanceof Error ? e.message : 'Erreur'); }
  };

  return (
    <Shell breadcrumb={<EntityBreadcrumb entity="project" id={projectId} tail="Kanban" />}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kanban</h1>
        <Link to={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground">← Projet</Link>
      </div>
      {(error ?? loadError) && <p className="mb-4 text-sm text-destructive">{error ?? loadError}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.key);
          return (
            <div
              key={col.key}
              className="rounded-lg border border-border bg-card/50 p-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragId != null) { move(dragId, col.key); setDragId(null); } }}
            >
              <div className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
                <span>{col.label}</span><span>{colTasks.length}</span>
              </div>
              <div className="space-y-2">
                {colTasks.map((t) => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    className="cursor-grab rounded-md border border-border bg-card p-2 text-xs active:cursor-grabbing"
                  >
                    <Link to={`/tasks/${t.id}`} className="font-medium hover:underline">{t.name}</Link>
                    <div className="mt-1 text-muted-foreground">{t.shotCode} · {t.type}</div>
                    {t.assignee && <div className="text-muted-foreground">→ {t.assignee.name}</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
