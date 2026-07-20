import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';

/** Valeur ISO → `YYYY-MM-DD` pour un <input type="date"> (chaîne vide si absente). */
const toInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
const fmt = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

/**
 * Planning d'une tâche (43.C) : début planifié + échéance. Édition réservée aux superviseurs ;
 * les autres voient les dates en lecture seule (rien si aucune date). Alimente calendrier/Gantt.
 */
export default function TaskSchedule({
  taskId,
  projectId,
  startDate,
  dueDate,
  canEdit,
}: {
  taskId: number;
  projectId: number | null;
  startDate: string | null | undefined;
  dueDate: string | null | undefined;
  canEdit: boolean;
}) {
  const qc = useQueryClient();

  const save = async (field: 'startDate' | 'dueDate', value: string) => {
    try {
      await api.patch(`/api/tasks/${taskId}`, {
        [field]: value ? new Date(value).toISOString() : null,
      });
      qc.invalidateQueries({ queryKey: qk.task(taskId) });
      if (projectId) qc.invalidateQueries({ queryKey: qk.projectSchedule(projectId) });
      toast.success('Planning mis à jour');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    }
  };

  if (!canEdit) {
    if (!startDate && !dueDate) return null;
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <CalendarDays size={14} />
        {startDate && <span>Début : {fmt(startDate)}</span>}
        {dueDate && <span>Échéance : {fmt(dueDate)}</span>}
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 text-xs">
      <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
        <CalendarDays size={14} /> Planning
      </span>
      <label className="flex items-center gap-1.5">
        Début
        <input
          type="date"
          value={toInput(startDate)}
          onChange={(e) => save('startDate', e.target.value)}
          className="rounded border border-input bg-background px-2 py-1"
        />
      </label>
      <label className="flex items-center gap-1.5">
        Échéance
        <input
          type="date"
          value={toInput(dueDate)}
          onChange={(e) => save('dueDate', e.target.value)}
          className="rounded border border-input bg-background px-2 py-1"
        />
      </label>
    </div>
  );
}
