// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { ArrowRight, FolderKanban } from 'lucide-react';
import { projectPath } from '../../lib/slug';
import type { DashboardProject } from './homeTypes';
import type { WidgetVariant } from './homeWidgets';
import { useT } from '../../i18n';

/**
 * Projets de l'Accueil, en liste ou en grande grille (C2).
 *
 * La liste compacte convenait à une colonne latérale, mais elle rendait le projet — ce
 * qu'on vient chercher en premier — moins visible que le reste de la page. La variante
 * « grille » en fait l'élément le plus grand de l'accueil : une vignette par projet,
 * cliquable en entier, avec son avancement. Un studio qui n'a qu'un projet obtient une
 * tuile pleine largeur.
 */

function Progress({ p, compact }: { p: DashboardProject; compact?: boolean }) {
  if (p.totalTasks === 0) return null;
  const pct = Math.round((p.approvedTasks / p.totalTasks) * 100);
  const barColor = pct >= 80 ? 'bg-success' : pct >= 30 ? 'bg-primary' : 'bg-warning';
  return (
    <span className={`flex min-w-0 items-center gap-2 ${compact ? 'flex-1' : 'w-full'}`}>
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
        <span className={`block h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{pct} %</span>
    </span>
  );
}

export default function RecentProjects({
  projects,
  variant = 'list',
}: {
  projects: DashboardProject[];
  variant?: WidgetVariant;
}) {
  const t = useT();
  const grid = variant === 'grid';

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Link to="/projects" className="flex items-center gap-1 text-xs text-primary hover:underline">
          {t('reviews.filter.allProjects')} <ArrowRight size={12} />
        </Link>
      </div>
      {projects.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t('home.noProject')}</p>
      ) : grid ? (
        // Une seule tuile quand il n'y a qu'un projet : la couper en trois colonnes pour
        // n'en remplir qu'une donnerait un bloc bancal.
        <div
          className={`grid gap-3 ${
            projects.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
          }`}
        >
          {projects.map((p) => (
            <Link
              key={p.id}
              to={projectPath(p)}
              className="group flex flex-col overflow-hidden rounded-lg border border-border transition-colors hover:border-primary"
            >
              {/* Bornée en hauteur : sur un projet unique, un 16/9 pleine largeur occupait
                  tout l'écran et repoussait le reste de la page hors du champ. */}
              <span className="relative block aspect-video max-h-72 w-full overflow-hidden bg-muted">
                {p.thumbnailUrl ? (
                  <img
                    src={p.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <FolderKanban size={28} />
                  </span>
                )}
              </span>
              <span className="flex flex-col gap-1.5 p-3">
                <span className="truncate font-medium group-hover:text-primary">{p.name}</span>
                <Progress p={p} />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={projectPath(p)}
              className="group flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/60"
            >
              {p.thumbnailUrl ? (
                <img
                  src={p.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-8 w-12 shrink-0 rounded object-cover"
                />
              ) : (
                <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                  <FolderKanban size={14} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium group-hover:text-primary">{p.name}</span>
                <Progress p={p} compact />
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
