// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { ListTodo } from 'lucide-react';
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL } from '../../lib/taskStatus';
import type { DashboardTask } from './homeTypes';
import { useT } from '../../i18n';

/** Mes tâches assignées (non approuvées), triées par urgence côté serveur. */
export default function MyTasksCard({ tasks }: { tasks: DashboardTask[] }) {
  const t = useT();
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t('home.myTasks')}
      </h2>
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
          <ListTodo size={24} />
          {t('home.noAssignedTask')}
        </div>
      ) : (
        <div className="space-y-1">
          {tasks.map((t) => (
            <Link
              key={t.id}
              to={`/tasks/${t.id}`}
              className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-secondary/60"
            >
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${TASK_STATUS_COLOR[t.status]}`}
              >
                {TASK_STATUS_LABEL[t.status]}
              </span>
              <span className="truncate font-medium">{t.name}</span>
              {t.location && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{t.location}</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
