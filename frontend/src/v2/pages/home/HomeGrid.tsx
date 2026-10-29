// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Suspense, lazy, useState } from 'react';
import LatestReviews from './LatestReviews';
import MyTasksCard from './MyTasksCard';
import ActivityFeed from './ActivityFeed';
import StatsRow from './StatsRow';
import RecentProjects from './RecentProjects';
import WidgetFrame, { type WidgetDragHandle } from './WidgetFrame';
import {
  isWidgetId,
  reorderWidgets,
  setWidgetSetting,
  setWidgetSize,
  visibleWidgets,
  widgetSettings,
  type HomeResolvedSettings,
  type HomeWidgetId,
  type HomeWidgetSettings,
  type HomeWidgetsPref,
} from './homeWidgets';
import { WIDGET_ROW_GRID_CLASS, listCapacity, type WidgetSize } from '../../components/widgets/widgetSizing';
import type { DashboardData } from './homeTypes';

/**
 * Composable home grid (C2): twelve columns, each block carrying its footprint.
 *
 * Moving used to be done one notch at a time through a context menu, inside a column that a
 * block could never leave. Here everything moves anywhere, with the mouse as well as the keyboard
 * (dnd-kit handles both), and only in edit mode: outside edit mode the page stays a page, with no
 * handle or border.
 *
 * Batch 13: the page takes the size model of the overview, requested word for word ("the same
 * resize settings, window settings"). A block used to carry only a width, its height was that of
 * its content, and the grid aligned everything to the top: a short block opened a hole beneath it
 * that its neighbour could not fill. Each block now carries a **width in columns and a height in
 * rows**, set in a single gesture on the corner handle. The grid **packs** (`grid-flow-row-dense`),
 * and the content follows the size: a taller card really shows more lines.
 *
 * The drag-and-drop engine follows this rule all the way from F5: it is only downloaded when
 * entering edit mode. Outside edit mode the grid does not load the 16.8 kB gzip of @dnd-kit in
 * everyone's first load.
 */
const WidgetSortable = lazy(() => import('../../components/widgets/WidgetSortable'));

/** Size shown during a drag, before anything is saved. */
interface Preview extends WidgetSize {
  id: HomeWidgetId;
}

export default function HomeGrid({
  data,
  pref,
  editing,
  onPref,
  onHide,
  onEnterEdit,
}: {
  data: DashboardData;
  pref: HomeWidgetsPref | undefined;
  editing: boolean;
  onPref: (next: HomeWidgetsPref) => void;
  onHide: (id: HomeWidgetId) => void;
  onEnterEdit: () => void;
}) {
  const ids = visibleWidgets(pref);
  // The size under the cursor does not go through the preferences: a notch crossed is a preview,
  // not a decision. Only releasing saves.
  const [preview, setPreview] = useState<Preview | null>(null);

  const content = (id: HomeWidgetId, settings: HomeResolvedSettings) => {
    switch (id) {
      case 'stats':
        return <StatsRow stats={data.stats} />;
      case 'projects':
        return (
          <RecentProjects
            projects={data.recentProjects}
            variant={settings.variant}
            rows={settings.rows}
            span={settings.span}
          />
        );
      case 'myTasks':
        return <MyTasksCard tasks={data.myTasks} limit={listCapacity(settings.rows)} />;
      case 'latestReviews':
        return <LatestReviews reviews={data.latestReviews} rows={settings.rows} />;
      case 'activity':
        return <ActivityFeed items={data.activity} limit={listCapacity(settings.rows)} />;
    }
  };

  const widget = (id: HomeWidgetId, index: number, drag?: WidgetDragHandle) => {
    const saved = widgetSettings(id, pref);
    // The preview applies only to the block being dragged; the others keep their footprint.
    const settings: HomeResolvedSettings =
      preview?.id === id ? { ...saved, span: preview.span, rows: preview.rows } : saved;
    const apply = (patch: HomeWidgetSettings) => onPref(setWidgetSetting(id, patch, pref));
    const resize = (next: WidgetSize) => onPref(setWidgetSize(id, next, pref));
    // Moving by one place: the neighbour serves as target, through the same function as the drag.
    const move = (direction: -1 | 1) => {
      const neighbour = ids[index + direction];
      if (neighbour) onPref(reorderWidgets(id, neighbour, pref));
    };
    return (
      <WidgetFrame
        key={id}
        id={id}
        settings={settings}
        editing={editing}
        onSettings={apply}
        onHide={() => onHide(id)}
        onEdit={onEnterEdit}
        onMove={move}
        canMoveBefore={index > 0}
        canMoveAfter={index < ids.length - 1}
        onPreview={(next) => setPreview(next ? { id, ...next } : null)}
        onResize={resize}
        drag={drag}
      >
        <div data-density={settings.density} className={settings.density === 'compact' ? 'text-sm' : ''}>
          {content(id, settings)}
        </div>
      </WidgetFrame>
    );
  };

  const grid = <div className={WIDGET_ROW_GRID_CLASS}>{ids.map((id, index) => widget(id, index))}</div>;

  if (!editing) return grid;

  // Fallback identical to the final grid: while the module arrives, the page does not move. Only
  // the handles do not respond yet.
  return (
    <Suspense fallback={grid}>
      <WidgetSortable
        ids={ids}
        className={WIDGET_ROW_GRID_CLASS}
        onReorder={(from, to) => {
          // The move engine does not know the registry: it is the page that discards an identifier
          // it no longer recognizes.
          if (isWidgetId(from) && isWidgetId(to)) onPref(reorderWidgets(from, to, pref));
        }}
        renderWidget={(id, index, drag) => (isWidgetId(id) ? widget(id, index, drag) : null)}
      />
    </Suspense>
  );
}
