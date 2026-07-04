import { useDroppable } from '@dnd-kit/core';
import KanbanCard from './KanbanCard';
import type { BoardTask } from './kanbanTypes';

/** Colonne de statut : zone de dépôt (surbrillance quand une carte la survole). */
export default function KanbanColumn({ id, label, tasks }: { id: string; label: string; tasks: BoardTask[] }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-28 flex-col rounded-lg border p-2 transition-colors ${
        isOver ? 'border-primary bg-primary/5' : 'border-border bg-card/50'
      }`}
    >
      <div className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px]">{tasks.length}</span>
      </div>
      <div className="space-y-2">
        {tasks.map((t) => <KanbanCard key={t.id} task={t} />)}
      </div>
    </div>
  );
}
