import { useQueries, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useSequencesQuery, useShotsQuery } from '../../lib/queries';
import type { TaskStatus, TaskWithAssignee } from '../../types/api';
import type { BoardTask } from './kanbanTypes';

/**
 * Données du board kanban : shots + séquences + tâches (fan-out par shot),
 * et déplacement d'une carte (changement de statut) en update optimiste avec
 * rollback par invalidation. Une clé = une shape (cohérent 10.E1).
 */
export function useKanbanBoard(projectId: number) {
  const qc = useQueryClient();
  const shotsQ = useShotsQuery(projectId);
  const sequencesQ = useSequencesQuery(projectId);
  const shots = shotsQ.data ?? [];

  const taskQueries = useQueries({
    queries: shots.map((s) => ({
      queryKey: qk.tasks(s.id),
      queryFn: () => api.get<{ tasks: TaskWithAssignee[] }>(`/api/tasks?shotId=${s.id}`).then((d) => d.tasks),
    })),
  });

  const tasks: BoardTask[] = shots.flatMap((s, i) =>
    (taskQueries[i]?.data ?? []).map((t) => ({ ...t, shotId: s.id, shotCode: s.code, sequenceId: s.sequenceId ?? null })));

  const isLoading = shotsQ.isLoading || taskQueries.some((q) => q.isLoading);
  const loadError = (shotsQ.error ?? taskQueries.find((q) => q.error)?.error)?.message ?? null;

  // Déplacement optimiste dans le cache du shot concerné ; rollback par invalidation.
  const move = async (taskId: number, status: TaskStatus) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t || t.status === status) return;
    const key = qk.tasks(t.shotId);
    qc.setQueryData<TaskWithAssignee[]>(key, (old) => old?.map((x) => (x.id === taskId ? { ...x, status } : x)));
    try {
      await api.patch(`/api/tasks/${taskId}`, { status });
    } catch (e) {
      qc.invalidateQueries({ queryKey: key });
      toast.error(e instanceof Error ? e.message : 'Déplacement impossible');
    }
  };

  return { shots, sequences: sequencesQ.data?.sequences ?? [], tasks, isLoading, loadError, move };
}
