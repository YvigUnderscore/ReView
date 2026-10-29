// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { useStatusMenu } from '../../../lib/useStatusMenu';
import { useUndoToast } from '../../../lib/useUndoToast';
import { useProjectMembers } from '../../../lib/useProjectRole';
import { currentStatusValue } from '../../../lib/statusMenu';
import type { MenuEntry } from '../../../lib/menuSpec';
import type { TaskStatus } from '../../../types/api';
import { useT, type Tr } from '../../../i18n';
import type { GridCell, GridRow } from './gridWire';

/**
 * The grid's gestures, mounted ONCE for the whole table.
 *
 * Twelve hundred cells, and each must be able to change its status or assignee on right-click. A hook per cell would have
 * opened twelve hundred reference-data requests: the menus are therefore built here and distributed as data, exactly as the
 * kanban distributes its `menuFor`.
 *
 * The status rule is not rewritten: the offered choices, the ticked value, the body of the `PATCH` and the sending to ShotGrid
 * come from `lib/statusMenu` via `useStatusMenu`. This module only adds what the grid knows on top: refreshing ITS pages
 * afterwards, since the cursor-paginated list is in none of the caches that the shared submenu invalidates.
 */

/** "Nobody" sentinel: a radio group cannot carry an empty value. */
const NO_ASSIGNEE = 'none';

export interface GridActions {
  /** Menu of a cell: status, assignment. Empty if the cell carries no task. */
  cellMenuFor: (cell: GridCell) => MenuEntry[];
  /** Menu of the head column: the shot's own status. */
  shotMenuFor: (row: GridRow) => MenuEntry[];
  /** Member photo, for a cell's avatar: the grid only serves identifiers. */
  avatarOf: (userId: number) => string | null;
}

/** Dot in the reference data's tint: a fragment, not a component (this module is a hook). */
function statusDot(color: string | null) {
  if (!color) return <span className="size-2.5 shrink-0" />;
  return (
    <span
      className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/20"
      style={{ backgroundColor: color }}
    />
  );
}

/** The entity as `currentStatusValue` expects it, read from a cell. */
function cellTarget(cell: GridCell) {
  const legacy = cell.status && cell.status.id === null ? (cell.status.code as TaskStatus) : null;
  return { id: cell.taskId ?? 0, pipelineStatusId: cell.status?.id ?? null, status: legacy };
}

type StatusMenu = ReturnType<typeof useStatusMenu>;

/**
 * An entity's "Status" submenu, followed by the grid's refresh.
 *
 * `useStatusMenu.entry()` does not suit as it is: it cannot refresh the grid's pages, which sit in no shared cache. We
 * therefore take over its CHOICES, the rule, and hand it the write, with what it must replay afterwards (`after`) and the
 * previous value (`undoTo`), which makes "Undo" appear in the toast.
 */
function statusSubmenu(
  menu: StatusMenu,
  entityId: number,
  target: { pipelineStatusId: number | null; status: TaskStatus | null },
  t: Tr,
  refresh: () => Promise<void>,
): MenuEntry | null {
  if (menu.choices.length === 0) return null;
  const value = currentStatusValue(menu.choices, target);
  return {
    kind: 'submenu',
    id: 'grid-status',
    label: t('pipeline.status.menu'),
    icon: <Tag size={14} />,
    items: [
      {
        kind: 'radiogroup',
        id: 'grid-status-group',
        value,
        // Radix calls the handler again on the already ticked item: without this exit, each opening followed by a click
        // would go back to the server for nothing.
        onValueChange: (next) => {
          if (next === value) return;
          void menu.apply(entityId, next, { undoTo: value, after: refresh });
        },
        items: menu.choices.map((choice) => ({
          id: `grid-status-${choice.value}`,
          value: choice.value,
          label: choice.label,
          icon: statusDot(choice.color),
        })),
      },
    ],
  };
}

export function useGridActions(projectId: number, canEdit: boolean): GridActions {
  const t = useT();
  const qc = useQueryClient();
  const { done } = useUndoToast();
  const taskStatus = useStatusMenu(projectId, 'task');
  const shotStatus = useStatusMenu(projectId, 'shot');
  const members = useProjectMembers(projectId);

  const avatars = useMemo(() => new Map(members.map((member) => [member.id, member.avatarUrl])), [members]);

  /** All the pages of the grid, whatever the current filter. */
  const refresh = () => qc.invalidateQueries({ queryKey: qk.projectGridAll(projectId) });

  /**
   * The assignment write, separated from the mutation: the undo replays it in reverse, and its failure must bubble up to
   * the toast that offered it rather than become a second success.
   */
  const writeAssignee = async (taskId: number, assigneeId: number | null): Promise<void> => {
    await api.patch(`/api/tasks/${taskId}`, { assigneeId });
    await refresh();
  };

  const assign = useMutation({
    mutationFn: (vars: { taskId: number; assigneeId: number | null; previous: number | null }) =>
      writeAssignee(vars.taskId, vars.assigneeId),
    onSuccess: (_data, vars) => {
      const member = members.find((m) => m.id === vars.assigneeId);
      // Restoring the previous assignee is one more write, not a local rollback: a step offered in the toast, and nothing
      // that resembles a stack (cf. `useUndoToast`).
      done(member ? t('production.grid.assigned', { name: member.name }) : t('production.grid.cleared'), () =>
        writeAssignee(vars.taskId, vars.previous),
      );
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t('common.error.generic')),
  });

  const assignEntry = (cell: GridCell, taskId: number): MenuEntry | null => {
    if (members.length === 0) return null;
    const value = cell.assignee ? String(cell.assignee.id) : NO_ASSIGNEE;
    return {
      kind: 'submenu',
      id: 'grid-assign',
      label: t('production.grid.assign'),
      icon: <UserRound size={14} />,
      items: [
        {
          kind: 'radiogroup',
          id: 'grid-assign-group',
          value,
          onValueChange: (next) => {
            if (next === value) return;
            assign.mutate({
              taskId,
              assigneeId: next === NO_ASSIGNEE ? null : Number(next),
              previous: cell.assignee?.id ?? null,
            });
          },
          items: [
            ...members.map((member) => ({
              id: `grid-assign-${member.id}`,
              value: String(member.id),
              label: member.name,
            })),
            { id: 'grid-assign-none', value: NO_ASSIGNEE, label: t('production.grid.unassigned') },
          ],
        },
      ],
    };
  };

  const cellMenuFor = (cell: GridCell): MenuEntry[] => {
    const taskId = cell.taskId;
    // No task, no menu: changing the status of an empty cell makes no sense, and `tidyMenu` would make a menu with no entries
    // disappear anyway.
    if (!canEdit || taskId === null) return [];
    const entries = [
      statusSubmenu(taskStatus, taskId, cellTarget(cell), t, refresh),
      assignEntry(cell, taskId),
    ];
    return entries.filter((entry): entry is MenuEntry => entry !== null);
  };

  const shotMenuFor = (row: GridRow): MenuEntry[] => {
    if (!canEdit) return [];
    // A shot has no fallback on the frozen enum: its `PATCH` accepts only the reference data.
    const target = { pipelineStatusId: row.status?.id ?? null, status: null };
    const entry = statusSubmenu(shotStatus, row.shotId, target, t, refresh);
    return entry ? [entry] : [];
  };

  return { cellMenuFor, shotMenuFor, avatarOf: (userId) => avatars.get(userId) ?? null };
}
