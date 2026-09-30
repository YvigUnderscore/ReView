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
 * Une tâche qui m'est assignée, en ligne actionnable : statut au clic droit (même mutation
 * que le kanban), échéance visible quand elle existe, ouverture au clic.
 *
 * Partagée par le bloc « mes tâches » de l'Accueil et par la page qui le déplie : les deux
 * montrent la même ligne parce qu'on y fait le même geste. La dupliquer aurait suffi à ce
 * que le menu contextuel n'existe que d'un côté.
 */

/** Ce dont la ligne a besoin — un sous-ensemble structurel, pas un type d'API de plus. */
export interface AssignedTask {
  id: number;
  name: string;
  status: TaskStatus;
  location: string;
  dueDate: string | null;
  /** Renseigné par la page transverse : à l'Accueil, le projet est déjà le contexte. */
  projectName?: string | null;
}

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
      // La page « mes tâches » lit la même vérité : un statut changé depuis l'Accueil doit
      // l'en retirer aussi, et réciproquement.
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
