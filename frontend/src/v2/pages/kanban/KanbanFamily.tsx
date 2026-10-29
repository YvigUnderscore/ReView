// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { memo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import KanbanColumn from './KanbanColumn';
import { FAMILY_LABEL_KEY, type FamilyGroup, type FamilyKey } from './kanbanColumns';
import type { MenuEntry } from '../../lib/menuSpec';
import type { BoardTask } from './kanbanTypes';
import { useT } from '../../i18n';

/** An empty column keeps the same array: otherwise the column would re-render for no reason. */
const EMPTY_COLUMN: BoardTask[] = [];

/**
 * A status family, collapsible (C4).
 *
 * Fifteen columns side by side cannot be read. Collapsed, a family becomes a simple counter: one
 * keeps "done" and "dropped" closed in order to work, and reopens them to check. Collapsing is a
 * display, not a filter: the cards remain counted.
 *
 * `onToggle` receives the family's key rather than being a closure per family: the page can thus
 * pass a stable callback, otherwise the memoization of the columns would fall apart at every render
 * of the board.
 *
 * The family NO LONGER has its own scrolling strip (Phase 50): it is a slice of the board, and it
 * is the board that scrolls horizontally, in a single movement. Each family used to have its own
 * scrollbar, so two columns from two families never ended up one beneath the other: one compared
 * two offset views of the same project.
 */
function KanbanFamily({
  group,
  tasksByColumn,
  collapsed,
  onToggle,
  menuFor,
  activeTaskId,
}: {
  group: FamilyGroup;
  tasksByColumn: Map<string, BoardTask[]>;
  collapsed: boolean;
  onToggle: (key: FamilyKey) => void;
  menuFor?: (task: BoardTask) => MenuEntry[];
  activeTaskId?: number | null;
}) {
  const t = useT();
  const total = group.columns.reduce((n, c) => n + (tasksByColumn.get(c.id)?.length ?? 0), 0);

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <button
        type="button"
        onClick={() => onToggle(group.key)}
        aria-expanded={!collapsed}
        className="mb-2 flex shrink-0 items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-xs font-semibold section-label text-muted-foreground transition-colors hover:text-foreground"
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        {t(FAMILY_LABEL_KEY[group.key])}
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-2xs tabular-nums normal-case">
          {total}
        </span>
      </button>
      {!collapsed && (
        <div className="flex min-h-0 flex-1 gap-3">
          {group.columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              tasks={tasksByColumn.get(column.id) ?? EMPTY_COLUMN}
              menuFor={menuFor}
              activeTaskId={activeTaskId}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default memo(KanbanFamily);
