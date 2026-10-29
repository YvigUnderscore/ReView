// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { TASK_STATUSES, TASK_STATUS_BAR, TASK_STATUS_LABEL_KEY } from '../../../lib/taskStatus';
import { useProjectActivity } from './useProjectActivity';
import { useT } from '../../../i18n';

/**
 * Project progress: the distribution of tasks by status, as a gauge and its legend.
 *
 * The tasks are those served by `/api/projects/:id/activity`, exactly those listed by the "tasks to
 * handle" block, so the gauge and the list cannot contradict each other.
 */
export default function ProgressWidget({ projectId }: { projectId: number }) {
  const t = useT();
  const { tasks } = useProjectActivity(projectId);
  const total = tasks.length;
  const byStatus = TASK_STATUSES.map((status) => ({
    status,
    count: tasks.filter((task) => task.status === status).length,
  })).filter((bucket) => bucket.count > 0);

  if (total === 0) return <p className="text-xs text-muted-foreground">{t('activity.noTask')}</p>;

  return (
    <>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-secondary/40">
        {byStatus.map((bucket) => (
          <div
            key={bucket.status}
            title={`${t(TASK_STATUS_LABEL_KEY[bucket.status])} · ${bucket.count}`}
            className={`${TASK_STATUS_BAR[bucket.status] ?? 'bg-muted-foreground/40'} transition-all`}
            style={{ width: `${(bucket.count / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {byStatus.map((bucket) => (
          <span key={bucket.status} className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${TASK_STATUS_BAR[bucket.status] ?? 'bg-muted-foreground/40'}`}
            />
            {t(TASK_STATUS_LABEL_KEY[bucket.status])} · {bucket.count}
          </span>
        ))}
      </div>
    </>
  );
}
