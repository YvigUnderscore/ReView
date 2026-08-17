// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { ArrowRight, FolderKanban } from 'lucide-react';
import { projectPath } from '../../lib/slug';
import type { DashboardProject } from './homeTypes';
import { useT } from '../../i18n';

/**
 * Projets récents — colonne latérale de l'Accueil. Refonte G : les données viennent
 * du dashboard (une seule requête) et chaque projet montre sa progression
 * (tâches approuvées / total), pour que la liste dise « où on en est », pas juste « quoi ».
 */

function Progress({ p }: { p: DashboardProject }) {
  if (p.totalTasks === 0) return null;
  const pct = Math.round((p.approvedTasks / p.totalTasks) * 100);
  const barColor = pct >= 80 ? 'bg-success' : pct >= 30 ? 'bg-primary' : 'bg-warning';
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
        <span className={`block h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{pct} %</span>
    </span>
  );
}

export default function RecentProjects({ projects }: { projects: DashboardProject[] }) {
  const t = useT();
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('home.recentProjects')}
        </h2>
        <Link to="/projects" className="flex items-center gap-1 text-xs text-primary hover:underline">
          {t('reviews.filter.allProjects')} <ArrowRight size={12} />
        </Link>
      </div>
      {projects.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t('home.noProject')}</p>
      ) : (
        <div className="space-y-1">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={projectPath(p)}
              className="group flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/60"
            >
              {p.thumbnailUrl ? (
                <img src={p.thumbnailUrl} alt="" className="h-8 w-12 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                  <FolderKanban size={14} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium group-hover:text-primary">{p.name}</span>
                <Progress p={p} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
