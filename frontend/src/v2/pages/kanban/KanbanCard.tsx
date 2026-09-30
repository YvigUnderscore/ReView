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

/** Contenu visuel d'une carte (partagé entre la carte draggable et le DragOverlay). */
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
 * Carte déplaçable : le drag ne s'active qu'après un mouvement (le clic ouvre la tâche).
 *
 * La carte reçoit le **constructeur** de son menu, pas ses entrées : construire quinze
 * entrées de statut par carte au niveau de la page annulait toute mémoïsation, puisque
 * le tableau d'entrées était neuf à chaque rendu. Ici, tant que la tâche et le
 * constructeur ne bougent pas, la carte ne se rend pas du tout — c'est ce qui permet à
 * une frappe dans la recherche de ne pas rejouer les cartes d'une colonne dense.
 */
function KanbanCard({
  task,
  menuFor,
}: {
  task: BoardTask;
  /** Menu contextuel de la carte — le statut s'y change sans traverser le board. */
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
  // `nested` : le board porte son propre menu contextuel, les deux s'ouvriraient ensemble.
  return (
    <EntityContextMenu entries={entries} nested>
      {card}
    </EntityContextMenu>
  );
}

export default memo(KanbanCard);
