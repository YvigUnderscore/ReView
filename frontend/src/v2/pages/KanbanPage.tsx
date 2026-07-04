import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { KanbanSquare } from 'lucide-react';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import EmptyState from '../components/ui/empty-state';
import { TASK_STATUSES, TASK_STATUS_LABEL } from '../lib/taskStatus';
import type { TaskStatus, UserRef } from '../types/api';
import { useKanbanBoard } from './kanban/useKanbanBoard';
import KanbanColumn from './kanban/KanbanColumn';
import { KanbanCardBody } from './kanban/KanbanCard';
import KanbanFilters, { type KanbanFilterState } from './kanban/KanbanFilters';

const EMPTY_FILTER: KanbanFilterState = { assignee: '', type: '', sequence: '' };

export default function KanbanPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const { sequences, tasks, isLoading, loadError, move } = useKanbanBoard(projectId);
  const [filter, setFilter] = useState<KanbanFilterState>(EMPTY_FILTER);
  const [activeId, setActiveId] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Assignés distincts présents sur le board (pour le filtre).
  const assignees: UserRef[] = useMemo(() => {
    const m = new Map<number, string | null>();
    tasks.forEach((t) => {
      if (t.assignee) m.set(t.assignee.id, t.assignee.name);
    });
    return [...m].map(([aid, name]) => ({ id: aid, name }));
  }, [tasks]);

  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        if (filter.assignee === 'none' && t.assignee) return false;
        if (filter.assignee && filter.assignee !== 'none' && String(t.assignee?.id) !== filter.assignee)
          return false;
        if (filter.type && t.type !== filter.type) return false;
        if (filter.sequence === 'none' && t.sequenceId != null) return false;
        if (filter.sequence && filter.sequence !== 'none' && String(t.sequenceId) !== filter.sequence)
          return false;
        return true;
      }),
    [tasks, filter],
  );

  const activeTask = activeId != null ? (tasks.find((t) => t.id === activeId) ?? null) : null;

  const onDragStart = (e: DragStartEvent) => setActiveId(Number(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (e.over?.id != null) move(Number(e.active.id), e.over.id as TaskStatus);
  };

  return (
    <Shell breadcrumb={<EntityBreadcrumb entity="project" id={projectId} tail="Kanban" />}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Kanban</h1>
        <KanbanFilters value={filter} onChange={setFilter} assignees={assignees} sequences={sequences} />
      </div>
      {loadError && <p className="mb-4 text-sm text-destructive">{loadError}</p>}
      {!isLoading && tasks.length === 0 ? (
        <EmptyState
          icon={KanbanSquare}
          title="Aucune tâche pour l'instant"
          description="Créez des shots et des tâches depuis le projet pour les suivre ici. Glissez une carte d'une colonne à l'autre pour changer son statut."
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {TASK_STATUSES.map((key) => (
              <KanbanColumn
                key={key}
                id={key}
                label={TASK_STATUS_LABEL[key]!}
                tasks={filtered.filter((t) => t.status === key)}
              />
            ))}
          </div>
          <DragOverlay>{activeTask && <KanbanCardBody task={activeTask} dragging />}</DragOverlay>
        </DndContext>
      )}
    </Shell>
  );
}
