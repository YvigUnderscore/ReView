// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Suspense, lazy, useState } from 'react';
import WidgetShell, { type WidgetDragHandle } from '@/v2/components/widgets/WidgetShell';
import RetakePanel from '@/v2/components/production/RetakePanel';
import type { WidgetSettings, WidgetsPref } from '@/v2/lib/widgetLayout';
import CountsWidget, { type ProjectCounts } from './CountsWidget';
import LatestMediaWidget from './LatestMediaWidget';
import ProgressWidget from './ProgressWidget';
import ActivityWidget from './ActivityWidget';
import TasksWidget from './TasksWidget';
import MyTasksWidget from './MyTasksWidget';
import AttentionWidget from './AttentionWidget';
import WidgetResizeHandle, { WidgetRowsChoice } from './WidgetResizeHandle';
import {
  OVERVIEW_GRID_CLASS,
  listCapacity,
  rowSpanClass,
  type OverviewRows,
  type WidgetSize,
} from './overviewSizing';
import {
  OVERVIEW_WIDGET_DEFS,
  isOverviewWidget,
  overviewWidgetSettings,
  reorderOverviewWidgets,
  setOverviewWidgetSetting,
  setOverviewWidgetSize,
  visibleOverviewWidgets,
  type OverviewWidgetId,
} from './overviewWidgets';
import { useT } from '@/v2/i18n';

/**
 * The overview grid: twelve columns, rows, and blocks that can be dragged.
 *
 * It used to align its blocks to the top and let them take the height of their content. A short
 * block therefore opened a hole beneath it that nothing could fill: the empty areas circled in red
 * on the screenshot. Each block now carries a **footprint**: a width in columns and a height in
 * rows, set in a single gesture on the corner handle. The grid **packs** (`grid-flow-row-dense`):
 * the rows a short block frees are taken by the first following block that fits there.
 *
 * Drag-and-drop follows the same rule as on the home page: @dnd-kit is only downloaded on entering
 * composition. Outside composition it is a page: no handle, no border, no button on the blocks.
 */
const WidgetSortable = lazy(() => import('@/v2/components/widgets/WidgetSortable'));

export interface OverviewGridProps {
  projectId: number;
  counts: ProjectCounts;
  canManage: boolean;
  layout: WidgetsPref;
  editing: boolean;
  onLayout: (next: WidgetsPref) => void;
  onHide: (id: OverviewWidgetId) => void;
  onEnterEdit: () => void;
  onGo: (tab: string) => void;
}

/** Size shown during a drag, before anything is saved. */
interface Preview extends WidgetSize {
  id: OverviewWidgetId;
}

export default function OverviewGrid({
  projectId,
  counts,
  canManage,
  layout,
  editing,
  onLayout,
  onHide,
  onEnterEdit,
  onGo,
}: OverviewGridProps) {
  const t = useT();
  const ids = visibleOverviewWidgets(layout, canManage);
  // The size under the cursor does not go through the preferences: a notch crossed is a preview,
  // not a decision. Only release saves.
  const [preview, setPreview] = useState<Preview | null>(null);

  const content = (id: OverviewWidgetId, size: WidgetSize) => {
    switch (id) {
      case 'counts':
        return <CountsWidget counts={counts} onGo={onGo} />;
      case 'myTasks':
        return <MyTasksWidget projectId={projectId} limit={listCapacity(size.rows)} />;
      case 'latestMedia':
        return <LatestMediaWidget projectId={projectId} rows={size.rows} span={size.span} />;
      case 'progress':
        return <ProgressWidget projectId={projectId} />;
      case 'activity':
        return <ActivityWidget projectId={projectId} limit={listCapacity(size.rows)} />;
      case 'tasks':
        return <TasksWidget projectId={projectId} canManage={canManage} limit={listCapacity(size.rows)} />;
      case 'attention':
        return <AttentionWidget projectId={projectId} />;
      case 'retakes':
        return <RetakePanel projectId={projectId} />;
    }
  };

  const widget = (id: OverviewWidgetId, index: number, drag?: WidgetDragHandle) => {
    const definition = OVERVIEW_WIDGET_DEFS[id];
    const saved = overviewWidgetSettings(id, layout);
    // The preview applies only to the block being dragged; the others keep their footprint.
    const size: WidgetSize =
      preview?.id === id
        ? { span: preview.span, rows: preview.rows }
        : { span: saved.span, rows: saved.rows };
    const settings = { ...saved, span: size.span, rows: size.rows };
    const title = t(definition.labelKey);

    const apply = (patch: WidgetSettings) => onLayout(setOverviewWidgetSetting(id, patch, layout));
    const resize = (next: WidgetSize) => onLayout(setOverviewWidgetSize(id, next, layout));
    const setRows = (rows: OverviewRows) => resize({ span: size.span, rows });
    // Moving by one place: the neighbour serves as target, through the same function as the drag.
    const move = (direction: -1 | 1) => {
      const neighbour = ids[index + direction];
      if (neighbour) onLayout(reorderOverviewWidgets(id, neighbour, layout));
    };

    return (
      <WidgetShell
        key={id}
        id={id}
        title={title}
        spans={definition.spans}
        variants={definition.variants}
        settings={settings}
        editing={editing}
        onSettings={apply}
        onHide={() => onHide(id)}
        onEdit={onEnterEdit}
        onMove={move}
        canMoveBefore={index > 0}
        canMoveAfter={index < ids.length - 1}
        drag={drag}
        rowSizing={{
          className: rowSpanClass(size.rows),
          control: <WidgetRowsChoice rows={size.rows} onRows={setRows} />,
          // The handle is a composition command: it lives with the move handle, and disappears
          // with it.
          handle: editing ? (
            <WidgetResizeHandle
              name={title}
              size={size}
              spans={definition.spans}
              onPreview={(next) => setPreview(next ? { id, ...next } : null)}
              onCommit={resize}
            />
          ) : null,
        }}
      >
        <div data-density={settings.density} className={settings.density === 'compact' ? 'text-sm' : ''}>
          {content(id, size)}
        </div>
      </WidgetShell>
    );
  };

  const grid = <div className={OVERVIEW_GRID_CLASS}>{ids.map((id, index) => widget(id, index))}</div>;

  if (!editing) return grid;

  // Fallback identical to the final grid: while the module arrives, the page does not move. Only
  // the handles do not respond yet.
  return (
    <Suspense fallback={grid}>
      <WidgetSortable
        ids={ids}
        className={OVERVIEW_GRID_CLASS}
        onReorder={(from, to) => {
          if (isOverviewWidget(from) && isOverviewWidget(to))
            onLayout(reorderOverviewWidgets(from, to, layout));
        }}
        renderWidget={(id, index, drag) => (isOverviewWidget(id) ? widget(id, index, drag) : null)}
      />
    </Suspense>
  );
}
