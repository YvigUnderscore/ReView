// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import Avatar from '../Avatar';
import { initialsFrom } from '../../lib/initials';
import type { ProductionOverview } from '../../types/production';
import { useT } from '../../i18n';

/**
 * Who does what (C6).
 *
 * A task's assignee has always been carried by the API and was displayed nowhere: impossible to see who carried what, or
 * who was overloaded. The bar shows the distribution of what remains: finished work no longer weighs on anyone.
 */
export default function WorkloadPanel({ data }: { data: ProductionOverview }) {
  const t = useT();
  if (data.workload.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('production.workload.empty')}</p>;
  }
  const max = Math.max(...data.workload.map((r) => r.total));

  return (
    <ul className="space-y-1.5">
      {data.workload.map((row) => (
        <li key={row.assigneeId ?? 'none'} className="flex items-center gap-3">
          <span className="flex w-44 shrink-0 items-center gap-2">
            {row.assigneeId !== null ? (
              <>
                <Avatar seed={row.assigneeId} initials={initialsFrom(row.name)} size={22} />
                <Link to={`/users/${row.assigneeId}`} className="truncate text-sm hover:text-primary">
                  {row.name ?? '—'}
                </Link>
              </>
            ) : (
              <span className="truncate text-sm italic text-muted-foreground">
                {t('activity.unassigned')}
              </span>
            )}
          </span>
          <span className="flex h-4 flex-1 overflow-hidden rounded bg-secondary" title={`${row.total}`}>
            <span className="flex h-full" style={{ width: `${max > 0 ? (row.total / max) * 100 : 0}%` }}>
              {row.progress > 0 && <span className="h-full bg-info" style={{ flexGrow: row.progress }} />}
              {row.review > 0 && <span className="h-full bg-warning" style={{ flexGrow: row.review }} />}
              {row.blocked > 0 && (
                <span className="h-full bg-destructive" style={{ flexGrow: row.blocked }} />
              )}
              {row.todo > 0 && (
                <span className="h-full bg-muted-foreground/40" style={{ flexGrow: row.todo }} />
              )}
            </span>
          </span>
          <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {row.total}
            {row.overdue > 0 && (
              <span className="ml-1.5 text-destructive">
                {t('production.workload.late', { count: row.overdue })}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
