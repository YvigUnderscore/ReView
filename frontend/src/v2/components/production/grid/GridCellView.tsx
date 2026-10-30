// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import Avatar from '../../Avatar';
import EntityContextMenu from '../../ui/entity-menu';
import { initialsFrom } from '@/v2/lib/initials';
import { FAMILY_BAR } from '../productionWire';
import { cellKind, statusName, type GridCell, type GridCellStatus, type GridDepartment } from './gridWire';
import type { GridActions } from './useGridActions';
import { intlLocale, useT, type Tr } from '@/v2/i18n';

/**
 * A grid cell: where THIS department stands on THIS shot.
 *
 * The cell **writes the status name** beside its dot. It did not before: colour alone forced one to hover over each cell to
 * know what it said, and a legend named only the five families, not the statuses of the project's reference data. The colour
 * stays, and that is the sharing: it reads at a glance down a whole column, while the name reads row by row.
 *
 * The rest (delivered versions, last activity, deadline) still waits for a hover, and the gestures for right-click: twelve
 * hundred cells cannot be read if each one tells its whole story.
 *
 * Three states, three drawings, and that is the distinction most lacking on the earlier screen: a filled dot **and a name**
 * for committed work, an empty ring for "scheduled, not started", and a simple dash for "not on this shot's schedule".
 */

const CELL = 'flex h-full items-center border-l border-border/40';

/** Short date, in the reader's language: never a frozen format. */
const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short' });

/**
 * Everything the cell knows, in one sentence: hover and speech synthesis.
 *
 * The department is named in it: the column says so at the top of the table, which is of no use once one has arrived at
 * the bottom by keyboard.
 */
function cellLabel(cell: GridCell, department: GridDepartment, t: Tr): string {
  const parts = [department.name, statusName(cell.status, t)];
  parts.push(cell.assignee?.name ?? t('production.grid.unassigned'));
  if (cell.versionCount > 0) parts.push(t('production.grid.versions', { count: cell.versionCount }));
  if (cell.lastActivityAt)
    parts.push(t('production.grid.lastActivity', { date: shortDate(cell.lastActivityAt) }));
  if (cell.dueDate) parts.push(t('production.grid.due', { date: shortDate(cell.dueDate) }));
  return parts.join(' · ');
}

/** The dot: tinted with the reference data's colour if the studio set one, otherwise with the family's colour. */
function StatusDot({ status }: { status: GridCellStatus | null }) {
  if (status?.color) {
    return (
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/20"
        style={{ backgroundColor: status.color }}
      />
    );
  }
  return (
    <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${FAMILY_BAR[status?.family ?? 'todo']}`} />
  );
}

export default function GridCellView({
  cell,
  department,
  colWidth,
  actions,
}: {
  /** Absent when the shot carries no cell for this column: treated as off-schedule. */
  cell: GridCell | undefined;
  department: GridDepartment;
  /** Column width at the moment: set by the longest status name on the page. */
  colWidth: number;
  actions: GridActions;
}) {
  const t = useT();
  const kind = cell ? cellKind(cell) : 'unscheduled';

  // The two cells without a task keep their centred mark and write nothing: they have no status to name, and it is this
  // very emptiness that distinguishes them from a committed cell.
  if (!cell || kind === 'unscheduled') {
    const label = `${department.name} · ${t('production.grid.unscheduled')}`;
    return (
      <div
        role="gridcell"
        aria-label={label}
        title={label}
        className={`${CELL} justify-center`}
        style={{ width: colWidth }}
      >
        <span aria-hidden className="h-px w-3 bg-border" />
      </div>
    );
  }

  if (kind === 'idle') {
    const label = `${department.name} · ${t('production.grid.idle')}`;
    return (
      <div
        role="gridcell"
        aria-label={label}
        title={label}
        className={`${CELL} justify-center`}
        style={{ width: colWidth }}
      >
        <span aria-hidden className="size-2.5 rounded-full border border-border" />
      </div>
    );
  }

  const label = cellLabel(cell, department, t);
  return (
    <div role="gridcell" className={CELL} style={{ width: colWidth }}>
      <EntityContextMenu entries={actions.cellMenuFor(cell)}>
        <button
          type="button"
          title={label}
          aria-label={label}
          // A left click opens the same menu as a right click: on a touch pad there is no right click, and the project's
          // rule puts every gesture in this menu.
          onClick={(event) =>
            event.currentTarget.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                clientX: event.clientX,
                clientY: event.clientY,
              }),
            )
          }
          // Width in PIXELS, not `w-full`: `EntityContextMenu` interposes a width-less `<div>` between the cell and the
          // button, and a percentage would resolve there to "content width": the name would overflow the column instead of
          // being cut. It is the same trap as the home-page card that resolved to zero height.
          // The cell measures `colWidth` including its border (`border-box`), hence the hairline removed.
          style={{ width: colWidth - 1 }}
          // The button fills the whole cell: the dots then line up from one row to the next, which is what makes the column
          // scannable, and the target of the right click is the size of what one sees.
          className="flex min-w-0 items-center gap-1 rounded px-1.5 py-1 transition-colors hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <StatusDot status={cell.status} />
          {/* `truncate` rather than a name shortened by hand: the column width is already sized for the longest name on the
              page, and the rare overflow is read on hover. No text measurement takes place per cell. */}
          <span className="min-w-0 flex-1 truncate text-left text-2xs leading-none">
            {statusName(cell.status, t)}
          </span>
          {cell.assignee && (
            <Avatar
              seed={cell.assignee.id}
              initials={initialsFrom(cell.assignee.name)}
              avatarUrl={actions.avatarOf(cell.assignee.id)}
              size={16}
            />
          )}
        </button>
      </EntityContextMenu>
    </div>
  );
}
