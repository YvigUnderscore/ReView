import { useDraggable } from '@dnd-kit/core';
import { Link } from 'react-router-dom';
import Avatar from '../../components/Avatar';
import { TASK_STATUS_BAR } from '../../lib/taskStatus';
import { initialsFrom, type BoardTask } from './kanbanTypes';

/** Contenu visuel d'une carte (partagé entre la carte draggable et le DragOverlay). */
export function KanbanCardBody({ task, dragging }: { task: BoardTask; dragging?: boolean }) {
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
          <div className="mt-0.5 truncate text-muted-foreground">{task.shotCode} · {task.type}</div>
        </div>
        {task.assignee && (
          <Avatar seed={task.assignee.id} initials={initialsFrom(task.assignee.name)} size={22} />
        )}
      </div>
    </div>
  );
}

/** Carte déplaçable : le drag ne s'active qu'après un mouvement (le clic ouvre la tâche). */
export default function KanbanCard({ task }: { task: BoardTask }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab touch-none active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}
    >
      <KanbanCardBody task={task} />
    </div>
  );
}
