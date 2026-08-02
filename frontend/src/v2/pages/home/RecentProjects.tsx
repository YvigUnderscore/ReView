// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { ArrowRight, FolderKanban } from 'lucide-react';
import { useProjectsQuery } from '../../lib/queries';
import { projectPath } from '../../lib/slug';
import { useT } from '../../i18n';

/** Projets récents (tri serveur updatedAt desc) — colonne latérale de l'Accueil. */
export default function RecentProjects() {
  const t = useT();
  const { data } = useProjectsQuery();
  const projects = (data ?? []).slice(0, 5);
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Projets récents
        </h2>
        <Link to="/projects" className="flex items-center gap-1 text-xs text-primary hover:underline">
          Tous les projets <ArrowRight size={12} />
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
              <span className="truncate text-sm font-medium group-hover:text-primary">{p.name}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
