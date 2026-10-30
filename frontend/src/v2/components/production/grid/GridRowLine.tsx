// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import EntityContextMenu from '../../ui/entity-menu';
import GridCellView from './GridCellView';
import { HEAD_W, lineWidth } from './gridLayout';
import type { GridDepartment, GridRow } from './gridWire';
import type { GridActions } from './useGridActions';
import { useT } from '@/v2/i18n';

/**
 * A grid row: a shot, and what each department has done with it.
 *
 * The head column carries the shot's **own status**. It has existed in the database since the approval workflow and was
 * displayed nowhere: one could set it by right-click in the tree without ever reading it back.
 */

/**
 * The shot's status, and the gesture to change it.
 *
 * A button, not plain text: the context menu must be reachable by keyboard, and a left click opens the same menu, since on a
 * touch pad there is no right click.
 */
function ShotStatusChip({ row, actions }: { row: GridRow; actions: GridActions }) {
  const t = useT();
  const entries = actions.shotMenuFor(row);
  const name = row.status?.name ?? t('pipeline.status.none');
  return (
    <EntityContextMenu entries={entries}>
      <button
        type="button"
        aria-label={`${t('production.grid.shotStatus')} · ${name}`}
        className="flex min-w-0 max-w-[7.5rem] items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring"
        onClick={(event) =>
          event.currentTarget.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              clientX: event.clientX,
              clientY: event.clientY,
            }),
          )
        }
      >
        {row.status?.color ? (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-black/20"
            style={{ backgroundColor: row.status.color }}
          />
        ) : (
          <span aria-hidden className="size-2 shrink-0 rounded-full border border-border" />
        )}
        <span className="truncate text-2xs text-muted-foreground">{name}</span>
      </button>
    </EntityContextMenu>
  );
}

export default function GridRowLine({
  row,
  columns,
  colWidth,
  actions,
}: {
  row: GridRow;
  columns: GridDepartment[];
  /** Width of a department column: the same for all, set by the table. */
  colWidth: number;
  actions: GridActions;
}) {
  // The cells arrive in the order of the WHOLE reference data; the visible columns are only a subset of it when empty
  // ones are hidden, hence the index by key.
  const byKey = new Map(row.cells.map((cell) => [cell.departmentKey, cell]));
  return (
    <div
      role="row"
      className="flex h-full items-center border-b border-border/40"
      style={{ width: lineWidth(columns.length, colWidth) }}
    >
      <div
        role="rowheader"
        className="sticky left-0 z-10 flex h-full min-w-0 items-center gap-1.5 bg-background px-2"
        style={{ width: HEAD_W }}
      >
        <Link
          to={`/shots/${row.shotId}`}
          title={row.name}
          className="shrink-0 text-xs font-medium hover:text-primary hover:underline"
        >
          {row.code}
        </Link>
        <ShotStatusChip row={row} actions={actions} />
      </div>
      {columns.map((department) => (
        <GridCellView
          key={department.key}
          cell={byKey.get(department.key)}
          department={department}
          colWidth={colWidth}
          actions={actions}
        />
      ))}
    </div>
  );
}
