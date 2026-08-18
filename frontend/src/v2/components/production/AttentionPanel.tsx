// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { AlertTriangle, Eye, UserX } from 'lucide-react';
import type { ProductionOverview, ProductionTask } from '../../types/production';
import { intlLocale, useT, type MessageKey } from '../../i18n';

/**
 * Ce qui demande une décision (C6) : en retard, sans assigné, en attente de review.
 *
 * Trois listes courtes plutôt qu'un indicateur agrégé : « 12 tâches en retard » ne dit pas
 * lesquelles, et c'est précisément ce qu'on vient chercher. Chaque ligne mène à la tâche.
 */

function TaskList({
  titleKey,
  icon,
  tasks,
  tone,
}: {
  titleKey: MessageKey;
  icon: React.ReactNode;
  tasks: ProductionTask[];
  tone: string;
}) {
  const t = useT();
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-3">
      <h3 className={`mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${tone}`}>
        {icon}
        {t(titleKey)}
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-2xs tabular-nums normal-case text-muted-foreground">
          {tasks.length}
        </span>
      </h3>
      {tasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('production.attention.none')}</p>
      ) : (
        <ul className="space-y-0.5">
          {tasks.slice(0, 8).map((task) => (
            <li key={task.id}>
              <Link
                to={`/tasks/${task.id}`}
                className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs hover:bg-secondary/60"
              >
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">{task.parentLabel}</span> · {task.name}
                </span>
                {task.dueDate && (
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {new Date(task.dueDate).toLocaleDateString(intlLocale(), {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                )}
              </Link>
            </li>
          ))}
          {tasks.length > 8 && (
            <li className="px-1 pt-1 text-2xs text-muted-foreground">
              {t('production.attention.more', { count: tasks.length - 8 })}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

export default function AttentionPanel({ data }: { data: ProductionOverview }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <TaskList
        titleKey="production.attention.overdue"
        icon={<AlertTriangle size={13} />}
        tasks={data.attention.overdue}
        tone="text-destructive"
      />
      <TaskList
        titleKey="production.attention.unassigned"
        icon={<UserX size={13} />}
        tasks={data.attention.unassigned}
        tone="text-warning"
      />
      <TaskList
        titleKey="production.attention.review"
        icon={<Eye size={13} />}
        tasks={data.attention.waitingReview}
        tone="text-info"
      />
    </div>
  );
}
