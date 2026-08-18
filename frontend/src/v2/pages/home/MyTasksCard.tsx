// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Flag, ListTodo, SquareArrowOutUpRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { TASK_STATUSES, TASK_STATUS_COLOR, TASK_STATUS_LABEL_KEY } from '../../lib/taskStatus';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import type { DashboardTask } from './homeTypes';
import { useT } from '../../i18n';

/**
 * Mes tâches assignées (non approuvées), triées par urgence côté serveur.
 * Refonte G : ligne actionnable — clic droit pour changer le statut sans quitter
 * l'Accueil (même mutation que le kanban), échéance visible quand elle existe.
 */

/** Échéance dépassée ? — hors composant, même motif que `timeAgo` (règle purity). */
const isPast = (d: Date) => d.getTime() < Date.now();

function DueDate({ iso }: { iso: string }) {
  const t = useT();
  const due = new Date(iso);
  const overdue = isPast(due);
  return (
    <span
      className={`shrink-0 text-xs ${overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
    >
      {t('home.due', { date: due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) })}
    </span>
  );
}

function TaskRow({ task }: { task: DashboardTask }) {
  const tr = useT();
  const qc = useQueryClient();
  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/api/tasks/${task.id}`, { status }),
    onSuccess: () => {
      toast.success(tr('home.statusUpdated'));
      void qc.invalidateQueries({ queryKey: qk.dashboard });
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

export default function MyTasksCard({ tasks }: { tasks: DashboardTask[] }) {
  const tr = useT();
  return (
    <div id="my-tasks" className="scroll-mt-6">
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
          <ListTodo size={24} />
          {tr('home.noAssignedTask')}
        </div>
      ) : (
        <div className="space-y-1">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}
