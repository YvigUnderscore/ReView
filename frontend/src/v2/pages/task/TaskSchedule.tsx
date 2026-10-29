// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useT } from '../../i18n';
import { intlLocale } from '../../i18n';

/** ISO value → `YYYY-MM-DD` for an <input type="date"> (empty string if absent). */
const toInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
const fmt = (iso: string) => new Date(iso).toLocaleDateString(intlLocale());

/**
 * Schedule of a task (43.C): planned start + due date. Editing is reserved for supervisors; the
 * others see the dates read-only (nothing if there is no date). Feeds the calendar/Gantt.
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
      void qc.invalidateQueries({ queryKey: qk.task(taskId) });
      if (projectId) void qc.invalidateQueries({ queryKey: qk.projectSchedule(projectId) });
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
