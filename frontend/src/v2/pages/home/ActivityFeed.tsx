// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { Activity, Film, GitBranch } from 'lucide-react';
import { timeAgo } from '../../lib/time';
import type { DashboardActivityItem } from './homeTypes';

/** Flux d'activité cross-projets : nouvelles versions et médias publiés. */
export default function ActivityFeed({ items }: { items: DashboardActivityItem[] }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Activité récente
      </h2>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
          <Activity size={24} />
          Rien à signaler pour l'instant.
        </div>
      ) : (
        <div className="space-y-0.5">
          {items.map((it, i) => {
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
                    {it.type === 'media' ? 'Média publié' : 'Nouvelle version'}
                    {it.author && ` par ${it.author}`} · {timeAgo(it.at)}
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
      )}
    </section>
  );
}
