import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/apiClient';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import { TASK_STATUSES, TASK_STATUS_LABEL } from '../lib/taskStatus';

interface Shot { id: number; code: string; }
interface Task { id: number; name: string; type: string; status: string; shotCode?: string; assignee: { name: string | null } | null; }

const COLUMNS = TASK_STATUSES.map((key) => ({ key, label: TASK_STATUS_LABEL[key] }));

export default function KanbanPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { shots } = await api.get<{ shots: Shot[] }>(`/api/shots?projectId=${projectId}`);
        const all: Task[] = [];
        for (const shot of shots) {
          const { tasks } = await api.get<{ tasks: Task[] }>(`/api/tasks?shotId=${shot.id}`);
          tasks.forEach((t) => all.push({ ...t, shotCode: shot.code }));
        }
        setTasks(all);
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
    })();
  }, [projectId]);

  const move = async (taskId: number, status: string) => {
    const prev = tasks;
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try { await api.patch(`/api/tasks/${taskId}`, { status }); }
    catch (e) { setTasks(prev); setError(e instanceof Error ? e.message : 'Erreur'); }
  };

  return (
    <Shell breadcrumb={<EntityBreadcrumb entity="project" id={projectId} tail="Kanban" />}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kanban</h1>
        <Link to={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground">← Projet</Link>
      </div>
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
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
