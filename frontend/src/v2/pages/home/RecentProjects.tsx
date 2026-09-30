// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import EntityThumb from '../../components/entity/EntityThumb';
import { projectPath } from '../../lib/slug';
import { contentCapacity, type WidgetRows } from '../../components/widgets/widgetSizing';
import type { DashboardProject } from './homeTypes';
import type { WidgetSpan, WidgetVariant } from './homeWidgets';
import { useT } from '../../i18n';

/**
 * Projets de l'Accueil, en liste ou en grande grille (C2).
 *
 * La liste compacte convenait à une colonne latérale, mais elle rendait le projet — ce
 * qu'on vient chercher en premier — moins visible que le reste de la page. La variante
 * « grille » en fait l'élément le plus grand de l'accueil : une vignette par projet,
 * cliquable en entier, avec son avancement. Un studio qui n'a qu'un projet obtient une
 * tuile pleine largeur.
 *
 * Lot 13 : le bloc porte une emprise (largeur en colonnes, hauteur en rangées) et son
 * contenu la suit. La **largeur** décide du nombre de colonnes de tuiles — une tuile de
 * projet est bien plus grande qu'une vignette de média, elle a donc sa propre rampe — et la
 * **hauteur** décide du nombre de rangées montrées. « Tous les projets », en haut du bloc,
 * mène au reste.
 */

/** Colonnes de tuiles selon la largeur du bloc, et les classes qui les portent. */
const TILE_COLUMNS: Record<WidgetSpan, { count: number; className: string }> = {
  3: { count: 1, className: 'grid-cols-1' },
  4: { count: 2, className: 'grid-cols-1 sm:grid-cols-2' },
  6: { count: 2, className: 'grid-cols-1 sm:grid-cols-2' },
  8: { count: 3, className: 'grid-cols-2 lg:grid-cols-3' },
  12: { count: 4, className: 'grid-cols-2 lg:grid-cols-4' },
};

/** Hauteur d'une tuile : son 16/9 (environ 150 px à quatre colonnes) plus son pied. */
const TILE_LINE = 200;

/** Hauteur d'une ligne de liste : sa vignette (`h-8`) et ses marges (`py-1.5`). */
const ROW_LINE = 44;

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
  rows,
  span,
}: {
  projects: DashboardProject[];
  variant?: WidgetVariant;
  rows: WidgetRows;
  span: WidgetSpan;
}) {
  const t = useT();
  const grid = variant === 'grid';
  const tiles = TILE_COLUMNS[span];
  const shown = projects.slice(
    0,
    grid ? tiles.count * contentCapacity(rows, TILE_LINE) : contentCapacity(rows, ROW_LINE, 2),
  );

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
        // Une seule tuile quand il n'y a qu'un projet à montrer : ouvrir plusieurs colonnes
        // pour n'en remplir qu'une donnerait un bloc bancal.
        <div className={`grid gap-3 ${shown.length === 1 ? 'grid-cols-1' : tiles.className}`}>
          {shown.map((p) => (
            <Link
              key={p.id}
              to={projectPath(p)}
              className="group flex flex-col overflow-hidden rounded-lg border border-border transition-colors hover:border-primary"
            >
              {/* Bornée en hauteur : sur un projet unique, un 16/9 pleine largeur occupait
                  tout l'écran et repoussait le reste de la page hors du champ. */}
              <span className="relative block aspect-video max-h-72 w-full overflow-hidden bg-muted">
                <EntityThumb
                  url={p.thumbnailUrl}
                  name={p.name}
                  className="transition-transform duration-300 group-hover:scale-105"
                />
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
          {shown.map((p) => (
            <Link
              key={p.id}
              to={projectPath(p)}
              className="group flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/60"
            >
              <span className="block h-8 w-12 shrink-0 overflow-hidden rounded bg-muted">
                <EntityThumb url={p.thumbnailUrl} name={p.name} variant="mini" />
              </span>
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
