// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { Activity, Film, GitBranch } from 'lucide-react';
import { timeAgo } from '../../lib/time';
import type { DashboardActivityItem } from './homeTypes';
import { intlLocale, useT } from '../../i18n';

/**
 * Cross-project activity feed: new versions and published media.
 * Redesign G: grouped by day (Today / Yesterday / date). The flat list mixed events from an hour
 * ago with events from a week ago, with no landmark between them.
 *
 * `limit` is the number of rows the block's size allows (batch 13): the feed is cut **before**
 * grouping, so that a day does not lose its heading along the way.
 */

/** Group label for a given day (stable key YYYY-MM-DD → displayable label). */
function dayLabel(iso: string, t: ReturnType<typeof useT>): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return t('calendar.today');
  if (sameDay(d, yesterday)) return t('home.yesterday');
  // `undefined` took the BROWSER's locale: the home page showed a French date ("dimanche 13 sept.")
  // in the middle of an English or Japanese interface.
  return d.toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'short' });
}

export default function ActivityFeed({ items, limit }: { items: DashboardActivityItem[]; limit: number }) {
  const t = useT();
  // Groups by day, in feed order (already sorted descending on the server).
  const groups: Array<{ label: string; items: DashboardActivityItem[] }> = [];
  for (const it of items.slice(0, limit)) {
    const label = dayLabel(it.at, t);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }

  return (
    <>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
          <Activity size={24} />
          {t('home.nothingToReport')}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-2 pb-0.5 text-2xs font-semibold section-label tracking-wider text-muted-foreground">
                {g.label}
              </p>
              <div className="space-y-0.5">
                {g.items.map((it, i) => {
                  const to = it.mediaId ? `/review/${it.mediaId}` : it.taskId ? `/tasks/${it.taskId}` : null;
                  const Icon = it.type === 'media' ? Film : GitBranch;
                  const body = (
                    <>
                      <Icon
                        size={14}
                        className={`mt-0.5 shrink-0 ${it.type === 'media' ? 'text-accent2' : 'text-primary'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {it.label}
                          {it.location && (
                            <span className="ml-1.5 text-xs text-muted-foreground">{it.location}</span>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {it.type === 'media' ? t('task.published') : t('activity.newVersion')}
                          {it.author && ` ${t('activity.by', { name: it.author })}`} · {timeAgo(it.at)}
                        </span>
                      </span>
                    </>
                  );
                  const cls = 'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left';
                  return to ? (
                    <Link key={i} to={to} className={`${cls} transition-colors hover:bg-secondary/60`}>
                      {body}
                    </Link>
                  ) : (
                    <div key={i} className={cls}>
                      {body}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
