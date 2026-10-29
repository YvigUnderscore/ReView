// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import KanbanCardList from './KanbanCardList';
import { statusSwatch } from '../../lib/contrast';
import { useTheme } from '../../stores/useTheme';
import type { Column } from './kanbanColumns';
import type { MenuEntry } from '../../lib/menuSpec';
import type { BoardTask } from './kanbanTypes';

/**
 * Status column: drop zone, fixed width, height bounded by the board (C4).
 *
 * The grid folded the columns onto two rows as soon as there were more than six, and a ShotGrid
 * board has fifteen, so the lower columns fell below the fold. A strip with a minimum width reads
 * like a real kanban: one scrolls horizontally, and each column keeps its place.
 *
 * The card stack, for its part, stopped at sixty and announced the rest without letting one reach
 * it. It now scrolls and mounts only its window (`KanbanCardList`). The drop zone remains the whole
 * column, header included: a card dropped on a column whose stack has not yet been scrolled still
 * reaches its destination.
 *
 * The header is FROZEN without `sticky` (Phase 50): it is simply outside the scrolling container.
 * The status name and its counter therefore stay readable whatever the position of the stack,
 * which is the first thing one looks for on a dense board.
 */
function KanbanColumn({
  column,
  tasks,
  menuFor,
  activeTaskId,
}: {
  column: Column;
  tasks: BoardTask[];
  menuFor?: (task: BoardTask) => MenuEntry[];
  activeTaskId?: number | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const isDark = useTheme((s) => s.theme) === 'dark';
  const swatch = statusSwatch(column.color, isDark);

  return (
    <div
      ref={setNodeRef}
      className={`flex h-full w-64 shrink-0 flex-col rounded-lg border p-2 transition-colors ${
        isOver ? 'border-primary bg-primary/5' : 'border-border bg-card/50'
      }`}
    >
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2 px-1 text-xs font-medium">
        <span
          className="truncate rounded px-1.5 py-0.5"
          style={swatch ? { backgroundColor: swatch.backgroundColor, color: swatch.color } : undefined}
          title={column.label}
        >
          {column.label}
        </span>
        <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-2xs tabular-nums">
          {tasks.length}
        </span>
      </div>
      <KanbanCardList tasks={tasks} menuFor={menuFor} activeTaskId={activeTaskId} />
    </div>
  );
}

export default memo(KanbanColumn);
