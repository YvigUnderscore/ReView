// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CircleDashed, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { usePipelineStatuses } from './shotgridApi';
import { useUndoToast } from './useUndoToast';
import { useT } from '../i18n';
import type { MenuEntry } from './menuSpec';
import type { TaskStatus } from '../types/api';
import {
  NO_STATUS,
  bodyForChoice,
  currentStatusValue,
  statusChoices,
  type StatusChoice,
  type StatusScope,
} from './statusMenu';

/**
 * "Status" submenu for any context menu.
 *
 * Setting a status used to require opening the entity's page and then its settings panel:
 * the most frequent gesture in production was the longest. It now fits in
 * a right click, on a shot card, a sequence row, a kanban card or
 * an entity page: same vocabulary everywhere, since it comes from the project's reference list.
 *
 * All three scopes share a single route (`PATCH /api/{scope}s/:id`), which validates that the
 * status belongs to the project and takes care of sending to ShotGrid.
 */

const ENDPOINT: Record<StatusScope, string> = {
  task: '/api/tasks',
  shot: '/api/shots',
  sequence: '/api/sequences',
  asset: '/api/assets',
};

/** What a caller can add to the write, beyond the status itself. */
export interface ApplyStatusOptions {
  /** Optimistic write into the caller's cache; returns the rollback. */
  onOptimistic?: (choice: StatusChoice | null) => () => void;
  /**
   * Value from BEFORE. When known, it shows "Undo" in the confirmation toast.
   *
   * This is one step, never a history: changing a status goes to the server and may
   * be arbitrated by ShotGrid behind it. Ctrl+Z would suggest a local stack we do not hold;
   * the toast, for its part, only promises the move just made, and disappears with it.
   */
  undoTo?: string;
  /** Caller-specific refresh (the grid paginates by cursor: no shared cache). */
  after?: () => Promise<unknown>;
}

export function useStatusMenu(projectId: number, scope: StatusScope) {
  const t = useT();
  const qc = useQueryClient();
  const { done } = useUndoToast();
  const { data: statuses = [] } = usePipelineStatuses(scope, projectId);
  const choices = statusChoices(statuses, scope, t);

  /**
   * The bare write: optimistic, and it **lets its failure bubble up**.
   *
   * Separated from `apply` because undo replays it: an undo failure must reach
   * the toast that offered it, not turn into a second success message.
   */
  const write = async (id: number, value: string, options: ApplyStatusOptions): Promise<void> => {
    const body = bodyForChoice(choices, value);
    if (!body) return;
    const choice = choices.find((c) => c.value === value) ?? null;
    const rollback = options.onOptimistic?.(choice);
    try {
      await api.patch(`${ENDPOINT[scope]}/${id}`, body);
    } catch (err) {
      rollback?.();
      throw err;
    } finally {
      // The server is authoritative: it may have derived a `status` from a different family, or
      // refused in favour of ShotGrid arbitration.
      void qc.invalidateQueries({ queryKey: qk.projectBoard(projectId) });
      if (scope === 'task') void qc.invalidateQueries({ queryKey: qk.task(id) });
      if (scope === 'shot') {
        void qc.invalidateQueries({ queryKey: qk.shot(id) });
        void qc.invalidateQueries({ queryKey: ['shots', projectId] });
      }
      if (scope === 'sequence') {
        void qc.invalidateQueries({ queryKey: qk.sequence(id) });
        void qc.invalidateQueries({ queryKey: qk.sequences(projectId) });
      }
      await options.after?.();
    }
  };

  /**
   * Applies the choice, showing the result before the server's reply, then confirming
   * — with "Undo" when the value from before is known (`undoTo`).
   *
   * `onOptimistic` is provided by the caller: caches do not all have the same shape
   * (the shot page keeps the `{ shot }` payload, the list keeps an array), and a
   * guessed write would silently break one or the other.
   */
  const apply = async (id: number, value: string, options: ApplyStatusOptions = {}) => {
    const choice = choices.find((c) => c.value === value) ?? null;
    try {
      await write(id, value, options);
      const message =
        value === NO_STATUS
          ? t('pipeline.status.cleared')
          : t('pipeline.status.set', { name: choice?.label ?? '' });
      const { undoTo } = options;
      done(
        message,
        undoTo === undefined
          ? undefined
          : () => write(id, undoTo, { onOptimistic: options.onOptimistic, after: options.after }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('pipeline.status.changeFailed'));
    }
  };

  /**
   * The menu entry. `allowClear` is false when the project is linked to ShotGrid: the
   * site cannot receive an empty status, and the next sync would bring back the
   * old value — offering the gesture would promise what we cannot keep.
   */
  const entry = (
    entity: StatusTarget,
    options: {
      canEdit?: boolean;
      allowClear?: boolean;
      onOptimistic?: (choice: StatusChoice | null) => () => void;
    } = {},
  ): MenuEntry | null => {
    if (options.canEdit === false || choices.length === 0) return null;
    const value = currentStatusValue(choices, entity);
    const items = [
      ...choices.map((choice) => ({
        id: `status-${choice.value}`,
        value: choice.value,
        label: choice.label,
        icon: statusDot(choice.color),
      })),
      ...(options.allowClear === false
        ? []
        : [
            {
              id: 'status-none',
              value: NO_STATUS,
              label: t('pipeline.status.none'),
              icon: <CircleDashed size={13} className="text-muted-foreground" />,
            },
          ]),
    ];
    return {
      kind: 'submenu',
      id: 'status',
      label: t('pipeline.status.menu'),
      icon: <Tag size={14} />,
      items: [
        {
          kind: 'radiogroup',
          id: 'status-group',
          value,
          // Radix calls the handler even when the already-checked item is clicked again:
          // without this exit, every opening followed by a click would go back to ShotGrid.
          onValueChange: (next) => {
            if (next === value) return;
            // `value` is the state from before, read when the menu opened: this is
            // exactly what "Undo" must restore.
            void apply(entity.id, next, { onOptimistic: options.onOptimistic, undoTo: value });
          },
          items,
        },
      ],
    };
  };

  return { entry, apply, choices, hasStatuses: choices.length > 0 };
}

export interface StatusTarget {
  id: number;
  pipelineStatusId?: number | null;
  status?: TaskStatus | null;
}

/**
 * Colour swatch of the reference list: a status is first recognised by its hue.
 *
 * A fragment produced on demand, not a component: this module exports a hook, and
 * declaring a component there would deprive the whole file of hot reload.
 */
function statusDot(color: string | null) {
  if (!color) return <span className="size-3 shrink-0" />;
  return (
    <span
      className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/20"
      style={{ backgroundColor: color }}
    />
  );
}
