// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useT } from '../../i18n';
import { intlLocale } from '../../i18n';

/** Valeur ISO → `YYYY-MM-DD` pour un <input type="date"> (chaîne vide si absente). */
const toInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
const fmt = (iso: string) => new Date(iso).toLocaleDateString(intlLocale());

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
  const t = useT();
  const qc = useQueryClient();

  const save = async (field: 'startDate' | 'dueDate', value: string) => {
    try {
      await api.patch(`/api/tasks/${taskId}`, {
        [field]: value ? new Date(value).toISOString() : null,
      });
      qc.invalidateQueries({ queryKey: qk.task(taskId) });
      if (projectId) qc.invalidateQueries({ queryKey: qk.projectSchedule(projectId) });
      toast.success(t('task.scheduleUpdated'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    }
  };

  if (!canEdit) {
    if (!startDate && !dueDate) return null;
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <CalendarDays size={14} />
        {startDate && <span>{t('task.startsOn', { date: fmt(startDate) })}</span>}
        {dueDate && (
          <span>
            {t('task.dueDate')} : {fmt(dueDate)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 text-xs">
      <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
        <CalendarDays size={14} /> {t('task.schedule')}
      </span>
      <label className="flex items-center gap-1.5">
        {t('common.start')}
        <input
          type="date"
          value={toInput(startDate)}
          onChange={(e) => save('startDate', e.target.value)}
          className="rounded border border-input bg-background px-2 py-1"
        />
      </label>
      <label className="flex items-center gap-1.5">
        {t('task.dueDate')}
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
