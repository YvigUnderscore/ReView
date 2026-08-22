// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useDeferredValue, useMemo, useState } from 'react';
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
import PageShell from '../components/PageShell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import EmptyState from '../components/ui/empty-state';
import EntityFilters from '../components/EntityFilters';
import { EMPTY_FILTERS, applyFilters } from '../lib/entityFilters';
import { TASK_TYPES } from './project/projectTypes';
import { useKanbanBoard } from './kanban/useKanbanBoard';
import { buildColumns, columnIdOf, groupByFamily, type FamilyKey } from './kanban/kanbanColumns';
import KanbanFamily from './kanban/KanbanFamily';
import { useProjectRole } from '../lib/useProjectRole';
import { useAuth } from '../stores/useAuth';
import { useStatusMenu } from '../lib/useStatusMenu';
import { entriesOf, type MenuEntry } from '../lib/menuSpec';
import type { BoardTask } from './kanban/kanbanTypes';
import { KanbanCardBody } from './kanban/KanbanCard';
import { parseIdParam } from '../lib/slug';
import { useT } from '../i18n';

/**
 * Kanban du projet (C4).
 *
 * Colonnes bâties sur le vocabulaire réel du projet — un site ShotGrid en a couramment
 * quinze, là où le board n'en montrait que six — regroupées en familles dépliables et
 * posées sur une bande scrollable plutôt que dans une grille qui les repliait en rangées.
 */
export default function KanbanPage() {
  const t = useT();
  const { id } = useParams();
  const projectId = parseIdParam(id);
  const board = useKanbanBoard(projectId);
  // Extraits du board : ces deux-là ont une identité stable et sont les seuls à voyager
  // jusqu'aux cartes mémoïsées.
  const { applyOptimisticStatus, move } = board;
  const { canManage } = useProjectRole(projectId);
  const myId = useAuth((s) => s.user?.id);
  const { entry: statusEntry, choices } = useStatusMenu(projectId, 'task');
  /**
   * Signature de ce dont le menu d'une carte dépend réellement : les droits, le compte,
   * le référentiel de statuts et la langue. Rien d'autre n'entre dans les entrées.
   */
  const menuEpoch = [
    projectId,
    canManage,
    myId ?? 0,
    t('pipeline.status.menu'),
    ...choices.map((c) => `${c.value}:${c.label}:${c.color ?? ''}`),
  ].join('|');
  /**
   * Menu d'une carte. L'assigné peut changer son propre statut — c'est très exactement ce
   * que le serveur autorise (il n'accepte de lui que le statut et la checklist), et c'est
   * le geste le plus utile de l'écran pour un artiste.
   *
   * `statusEntry` est reconstruit à chaque rendu du hook : le lister en dépendance rendrait
   * `menuFor` neuf à chaque frappe dans la recherche, donc toutes les cartes montées avec
   * lui — c'est ce que la mémoïsation vise précisément à éviter. `menuEpoch` résume à sa
   * place tout ce que la fermeture lit, si bien que l'identité change quand le menu change
   * et à ce moment-là seulement.
   */
  const menuFor = useCallback(
    (task: BoardTask): MenuEntry[] =>
      entriesOf(
        statusEntry(task, {
          canEdit: canManage || task.assignee?.id === myId,
          onOptimistic: (choice) => applyOptimisticStatus(task.id, choice),
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gouverné par `menuEpoch`, cf. ci-dessus
    [menuEpoch, applyOptimisticStatus],
  );
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  /**
   * Le filtre appliqué suit la frappe d'un temps de retard : sur une colonne dense, la
   * saisie restait en arrière du curseur pendant que le board se recalculait à chaque
   * lettre. Le champ, lui, reste piloté par `filters` — il répond au clavier tout de suite.
   */
  const deferredFilters = useDeferredValue(filters);
  const [collapsed, setCollapsed] = useState<ReadonlySet<FamilyKey>>(new Set());
  const [activeId, setActiveId] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const columns = useMemo(() => buildColumns(board.statuses, t), [board.statuses, t]);
  const groups = useMemo(() => groupByFamily(columns, new Set()), [columns]);

  // Assignés réellement présents sur le board : proposer tout l'annuaire n'aiderait pas.
  const assignees = useMemo(() => {
    const m = new Map<number, string | null>();
    board.tasks.forEach((task) => {
      if (task.assignee) m.set(task.assignee.id, task.assignee.name);
    });
    return [...m].map(([aid, name]) => ({ id: aid, name }));
  }, [board.tasks]);

  const filtered = useMemo(
    () =>
      applyFilters(deferredFilters, board.tasks, (task) => ({
        text: `${task.name} ${task.parentLabel}`,
        statusId: task.pipelineStatusId,
        legacyStatus: task.status,
        assigneeId: task.assignee?.id ?? null,
        sequenceId: task.sequenceId,
        departmentId: task.departmentId,
        type: task.type,
      })),
    [deferredFilters, board.tasks],
  );

  /** Une passe pour ranger les cartes, plutôt qu'un filtrage par colonne. */
  const tasksByColumn = useMemo(() => {
    const map = new Map<string, BoardTask[]>();
    for (const task of filtered) {
      const columnId = columnIdOf(task, columns);
      if (columnId === null) continue;
      const bucket = map.get(columnId);
      if (bucket) bucket.push(task);
      else map.set(columnId, [task]);
    }
    return map;
  }, [filtered, columns]);

  const activeTask = activeId != null ? (board.tasks.find((x) => x.id === activeId) ?? null) : null;

  const onDragStart = useCallback((e: DragStartEvent) => setActiveId(Number(e.active.id)), []);
  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveId(null);
      const target = columns.find((c) => c.id === e.over?.id);
      if (target) void move(Number(e.active.id), target);
    },
    [columns, move],
  );
  const onDragCancel = useCallback(() => setActiveId(null), []);

  // Rappel stable, la famille dit laquelle elle est : une fermeture par famille rendrait
  // toutes les colonnes à chaque rendu de la page.
  const toggleFamily = useCallback(
    (key: FamilyKey) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );

  return (
    <PageShell breadcrumb={<EntityBreadcrumb entity="project" id={projectId} tail="Kanban" />} width="fluid">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Kanban</h1>
        <EntityFilters
          scope={`kanban:${projectId}`}
          value={filters}
          onChange={setFilters}
          statuses={columns.map((c) => ({
            value: c.statusId != null ? String(c.statusId) : c.id,
            label: c.label,
          }))}
          assignees={assignees}
          sequences={board.sequences.map((s) => ({ value: String(s.id), label: s.code }))}
          departments={board.departments.map((d) => ({ value: String(d.id), label: d.name }))}
          types={TASK_TYPES}
          searchPlaceholder={t('kanban.searchPlaceholder')}
        />
      </div>
      {board.loadError && <p className="mb-4 text-sm text-destructive">{board.loadError}</p>}
      {/* Une troncature silencieuse se lirait comme un board complet. */}
      {board.truncated && (
        <p className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {t('kanban.truncated', { shown: board.tasks.length, total: board.total })}
        </p>
      )}

      {!board.isLoading && board.tasks.length === 0 ? (
        <EmptyState icon={KanbanSquare} title={t('task.noTaskYet')} description={t('kanban.emptyHint')} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div className="space-y-4">
            {groups.map((group) => (
              <KanbanFamily
                key={group.key}
                group={group}
                tasksByColumn={tasksByColumn}
                collapsed={collapsed.has(group.key)}
                onToggle={toggleFamily}
                menuFor={menuFor}
                activeTaskId={activeId}
              />
            ))}
          </div>
          <DragOverlay>{activeTask && <KanbanCardBody task={activeTask} dragging />}</DragOverlay>
        </DndContext>
      )}
    </PageShell>
  );
}
