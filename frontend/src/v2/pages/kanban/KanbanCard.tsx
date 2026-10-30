// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { memo, useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Link } from 'react-router-dom';
import Avatar from '../../components/Avatar';
import { TASK_STATUS_BAR } from '../../lib/taskStatus';
import { initialsFrom } from '../../lib/initials';
import EntityContextMenu from '../../components/ui/entity-menu';
import type { MenuEntry } from '../../lib/menuSpec';
import type { BoardTask } from './kanbanTypes';

/** Visual content of a card, shared between the draggable card and the DragOverlay. */
export const KanbanCardBody = memo(function KanbanCardBody({
  task,
  dragging,
}: {
  task: BoardTask;
  dragging?: boolean;
}) {
  return (
    <div
      className={`rounded-md border bg-card p-2.5 text-xs shadow-sm ${
        dragging ? 'border-primary shadow-lg' : 'border-border'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${TASK_STATUS_BAR[task.status]}`} />
        <div className="min-w-0 flex-1">
          <Link
            to={`/tasks/${task.id}`}
            onClick={(e) => e.stopPropagation()}
            className="block truncate font-medium text-foreground hover:underline"
          >
            {task.name}
          </Link>
          <div className="mt-0.5 truncate text-muted-foreground">
            {task.parentLabel} · {task.type}
          </div>
        </div>
        {task.assignee && (
          <Avatar seed={task.assignee.id} initials={initialsFrom(task.assignee.name)} size={22} />
        )}
      </div>
    </div>
  );
});

/**
 * Draggable card: the drag only activates after a movement (a click opens the task).
 *
 * The card receives the **builder** of its menu, not its entries: building fifteen status entries
 * per card at page level cancelled any memoization, since the entries array was new on each
 * render. Here, as long as the task and the builder do not change, the card does not render at
 * all, which is what lets a keystroke in the search avoid replaying the cards of a dense column.
 */
function KanbanCard({
  task,
  menuFor,
}: {
  task: BoardTask;
  /** Context menu of the card: the status is changed there without going through the board. */
  menuFor?: (task: BoardTask) => MenuEntry[];
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  const entries = useMemo(() => menuFor?.(task) ?? [], [menuFor, task]);
  const card = (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab touch-none active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}
    >
      <KanbanCardBody task={task} />
    </div>
  );
  if (entries.length === 0) return card;
  // `nested`: the board has its own context menu, and the two would open together.
  return (
    <EntityContextMenu entries={entries} nested>
      {card}
    </EntityContextMenu>
  );
}

export default memo(KanbanCard);
