// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { TASK_STATUS_BAR, TASK_STATUS_LABEL_KEY } from '../../lib/taskStatus';
import type { ScheduleTask } from '../../types/api';
import { useT } from '../../i18n';
import { intlLocale } from '../../i18n';

/** Abréviations de jours issues d'ICU — la semaine commence lundi (2026-01-05). */
function weekdays(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 0, 5 + i))));
}
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
/**
 * Midi UTC du jour visé, en ISO. À minuit, un lecteur situé à l'ouest de Greenwich verrait
 * l'échéance reculer d'un jour — c'est le genre de décalage qu'on ne remarque qu'en prod.
 */
function noonOf(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)).toISOString();
}

/**
 * Calendrier mensuel des échéances (43.C — №125), éditable depuis C6.
 *
 * Il était en lecture seule : on y voyait qu'une échéance tombait le mauvais jour sans
 * pouvoir la déplacer, il fallait ouvrir la tâche. Une échéance se glisse maintenant d'un
 * jour à l'autre — le geste qu'on attend d'un calendrier.
 */
export default function DeadlineCalendar({
  tasks,
  projectId,
  canEdit = false,
}: {
  tasks: ScheduleTask[];
  projectId: number;
  /** Déplacer une échéance écrit en base : réservé à qui gère le projet. */
  canEdit?: boolean;
}) {
  const tr = useT();
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [dragging, setDragging] = useState<number | null>(null);

  const setDue = useMutation({
    mutationFn: ({ taskId, date }: { taskId: number; date: string }) =>
      api.patch(`/api/tasks/${taskId}`, { dueDate: date }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projectSchedule(projectId) });
      void qc.invalidateQueries({ queryKey: qk.projectProductionAll(projectId) });
      toast.success(tr('calendar.dueMoved'));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : tr('common.error.generic')),
  });

  // Regroupe les tâches ayant une échéance par jour (clé locale YYYY-MM-DD).
  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleTask[]>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const key = dayKey(new Date(t.dueDate));
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
    return map;
  }, [tasks]);

  const weeks = useMemo(() => {
    const first = startOfMonth(month);
    const offset = (first.getDay() + 6) % 7; // lundi = 0
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const weeksCount = Math.ceil((offset + daysInMonth) / 7);
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - offset);
    const out: Date[][] = [];
    const cur = new Date(gridStart);
    for (let w = 0; w < weeksCount; w++) {
      const week: Date[] = [];
      for (let d = 0; d < 7; d++) {
        week.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
      }
      out.push(week);
    }
    return out;
  }, [month]);

  const todayKey = dayKey(new Date());
  const monthLabel = month.toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' });
  const shift = (delta: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold capitalize">{monthLabel}</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => shift(-1)}
            className="rounded-md border border-border p-1 hover:bg-secondary/60"
            aria-label={tr('stats.prevMonth')}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setMonth(startOfMonth(new Date()))}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary/60"
          >
            {tr('calendar.today')}
          </button>
          <button
            onClick={() => shift(1)}
            className="rounded-md border border-border p-1 hover:bg-secondary/60"
            aria-label={tr('common.nextMonth')}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekdays(intlLocale()).map((w) => (
          <div key={w} className="pb-1 text-center text-xs font-medium text-muted-foreground">
            {w}
          </div>
        ))}
        {weeks.flat().map((day) => {
          const key = dayKey(day);
          const inMonth = day.getMonth() === month.getMonth();
          const dayTasks = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              // Zone de dépôt : le calendrier reste lisible au clavier, où l'échéance
              // s'édite depuis la page de la tâche.
              onDragOver={canEdit ? (e) => e.preventDefault() : undefined}
              onDrop={
                canEdit
                  ? (e) => {
                      e.preventDefault();
                      const taskId = Number(e.dataTransfer.getData('text/task-id'));
                      setDragging(null);
                      if (taskId > 0) setDue.mutate({ taskId, date: noonOf(key) });
                    }
                  : undefined
              }
              className={`min-h-[76px] rounded-md border border-border/60 p-1 ${
                inMonth ? 'bg-background' : 'bg-secondary/20'
              } ${dragging !== null && canEdit ? 'border-dashed border-primary/40' : ''}`}
            >
              <div
                className={`mb-0.5 text-right text-xs ${
                  key === todayKey
                    ? 'font-semibold text-primary'
                    : inMonth
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/50'
                }`}
              >
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayTasks.slice(0, 3).map((t) => (
                  <Link
                    key={t.id}
                    to={`/tasks/${t.id}`}
                    draggable={canEdit}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/task-id', String(t.id));
                      setDragging(t.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    title={`${t.location} · ${t.name} — ${TASK_STATUS_LABEL_KEY[t.status] ? tr(TASK_STATUS_LABEL_KEY[t.status]) : t.status}`}
                    className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-2xs hover:bg-secondary/60"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${TASK_STATUS_BAR[t.status] ?? 'bg-muted-foreground/40'}`}
                    />
                    <span className="truncate">
                      {t.location && <span className="text-muted-foreground">{t.location} </span>}
                      {t.name}
                    </span>
                  </Link>
                ))}
                {dayTasks.length > 3 && (
                  <div className="px-1 text-2xs text-muted-foreground">+{dayTasks.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
