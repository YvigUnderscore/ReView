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
 * Home projects, as a list or a large grid (C2).
 *
 * The compact list suited a side column, but it made the project (what one comes for first) less
 * visible than the rest of the page. The "grid" variant makes it the largest element of the home
 * page: one thumbnail per project, fully clickable, with its progress. A studio with a single
 * project gets a full-width tile.
 *
 * Batch 13: the block carries a footprint (width in columns, height in rows) and its content
 * follows it. The **width** decides the number of tile columns (a project tile is much larger
 * than a media thumbnail, so it has its own scale), and the **height** decides the number of rows
 * shown. "All projects", at the top of the block, leads to the rest.
 */

/** Tile columns according to the block's width, and the classes that carry them. */
const TILE_COLUMNS: Record<WidgetSpan, { count: number; className: string }> = {
  3: { count: 1, className: 'grid-cols-1' },
  4: { count: 2, className: 'grid-cols-1 sm:grid-cols-2' },
  6: { count: 2, className: 'grid-cols-1 sm:grid-cols-2' },
  8: { count: 3, className: 'grid-cols-2 lg:grid-cols-3' },
  12: { count: 4, className: 'grid-cols-2 lg:grid-cols-4' },
};

/** Height of a tile: its 16/9 (about 150 px at four columns) plus its footer. */
const TILE_LINE = 200;

/** Height of a list row: its thumbnail (`h-8`) and its margins (`py-1.5`). */
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
        // A single tile when there is only one project to show: opening several columns to fill
        // only one would produce a lopsided block.
        <div className={`grid gap-3 ${shown.length === 1 ? 'grid-cols-1' : tiles.className}`}>
          {shown.map((p) => (
            <Link
              key={p.id}
              to={projectPath(p)}
              className="group flex flex-col overflow-hidden rounded-lg border border-border transition-colors hover:border-primary"
            >
              {/* Capped in height: on a single project, a full-width 16/9 would fill the whole
                  screen and push the rest of the page out of view. */}
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
