// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Flag, SquareArrowOutUpRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { TASK_STATUSES, TASK_STATUS_COLOR, TASK_STATUS_LABEL_KEY } from '../lib/taskStatus';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './ui/context-menu';
import type { TaskStatus } from '../types/api';
import { intlLocale, useT } from '../i18n';

/**
 * A task assigned to me, as an actionable row: status on right click (same mutation
 * as the kanban), due date shown when there is one, opened on click.
 *
 * Shared by the "my tasks" block of the Home page and by the page that expands it: both
 * show the same row because the same gesture is performed on it. Duplicating it would have sufficed to
 * make the context menu exist only on one side.
 */

/** What the row needs: a structural subset, not one more API type. */
export interface AssignedTask {
  id: number;
  name: string;
  status: TaskStatus;
  location: string;
  dueDate: string | null;
  /** Filled in by the cross-cutting page: on the Home page, the project is already the context. */
  projectName?: string | null;
}

/** Is the due date passed? Outside the component, same pattern as `timeAgo` (purity rule). */
const isPast = (d: Date) => d.getTime() < Date.now();

function DueDate({ iso }: { iso: string }) {
  const t = useT();
  const due = new Date(iso);
  const overdue = isPast(due);
  return (
    <span
      className={`shrink-0 text-xs ${overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
    >
      {t('home.due', { date: due.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' }) })}
    </span>
  );
}

export default function AssignedTaskRow({ task }: { task: AssignedTask }) {
  const tr = useT();
  const qc = useQueryClient();
  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/api/tasks/${task.id}`, { status }),
    onSuccess: () => {
      toast.success(tr('home.statusUpdated'));
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      // The "my tasks" page reads the same truth: a status changed from the Home page must
      // remove it from there as well, and vice versa.
      void qc.invalidateQueries({ queryKey: qk.myTasksAll });
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : tr('ctx.actionFailed', { action: tr('home.changeStatus') }),
      ),
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link
          to={`/tasks/${task.id}`}
          className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-secondary/60"
        >
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${TASK_STATUS_COLOR[task.status]}`}
          >
            {tr(TASK_STATUS_LABEL_KEY[task.status])}
          </span>
          <span className="truncate font-medium">{task.name}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {task.dueDate && <DueDate iso={task.dueDate} />}
            {task.projectName && <span className="text-xs text-muted-foreground">{task.projectName}</span>}
            {task.location && <span className="text-xs text-muted-foreground">{task.location}</span>}
          </span>
        </Link>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Flag size={14} /> {tr('home.changeStatus')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {TASK_STATUSES.map((s) => (
              <ContextMenuItem key={s} onClick={() => setStatus.mutate(s)}>
                <Check size={14} className={s === task.status ? 'opacity-100' : 'opacity-0'} />
                {tr(TASK_STATUS_LABEL_KEY[s])}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem asChild>
          <Link to={`/tasks/${task.id}`}>
            <SquareArrowOutUpRight size={14} /> {tr('home.openTask')}
          </Link>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
