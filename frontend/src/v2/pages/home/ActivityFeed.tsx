// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { Activity, Film, GitBranch } from 'lucide-react';
import { timeAgo } from '../../lib/time';
import type { DashboardActivityItem } from './homeTypes';
import { useT } from '../../i18n';

/**
 * Flux d'activité cross-projets : nouvelles versions et médias publiés.
 * Refonte G : groupé par jour (Aujourd'hui / Hier / date) — la liste plate mélangeait
 * des événements d'il y a une heure et d'il y a une semaine sans repère.
 */

/** Libellé de groupe d'un jour donné (clé stable AAAA-MM-JJ → libellé affichable). */
function dayLabel(iso: string, t: ReturnType<typeof useT>): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return t('calendar.today');
  if (sameDay(d, yesterday)) return t('home.yesterday');
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

export default function ActivityFeed({ items }: { items: DashboardActivityItem[] }) {
  const t = useT();
  // Groupes par jour, dans l'ordre du flux (déjà trié desc côté serveur).
  const groups: Array<{ label: string; items: DashboardActivityItem[] }> = [];
  for (const it of items) {
    const label = dayLabel(it.at, t);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t('home.recentActivity')}
      </h2>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
          <Activity size={24} />
          {t('home.nothingToReport')}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-2 pb-0.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70">
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
    </section>
  );
}
