// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { FileStack, Layers } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import PipelineStatusBadge from '../shotgrid/PipelineStatusBadge';
import { useT } from '../../i18n';

export interface PickableTask {
  id: number | null;
  name: string;
  department: string | null;
  pipelineStatusId?: number | null;
  versionCount: number;
}

/**
 * À quelle tâche appartient cette version ?
 *
 * Jusqu'ici la destination était le contexte de navigation : une version créée depuis un
 * asset s'y accrochait directement, sans jamais passer par une tâche. Sur un projet
 * ShotGrid, où le travail est découpé en tâches (modeling, texturing, art…), cela range
 * un rendu de texturing à côté de l'asset plutôt que sous l'étape qui l'a produit — et
 * la version poussée vers le site arrive sans `sg_task`.
 *
 * Les tâches proposées sont celles que la page a déjà chargées : sur un projet relié, ce
 * sont exactement celles de ShotGrid, importées par la synchronisation. Aucun appel au
 * site n'est nécessaire pour les proposer.
 */
export default function TaskPickerDialog({
  open,
  onOpenChange,
  tasks,
  allowNone,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: PickableTask[];
  /** Permettre de rattacher la version au parent plutôt qu'à une tâche. */
  allowNone?: boolean;
  onPick: (taskId: number | null) => void;
}) {
  const t = useT();

  const choose = (taskId: number | null) => {
    onOpenChange(false);
    onPick(taskId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('upload.pickTask.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('upload.pickTask.hint')}</p>

        <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">
          {tasks.map((task) => (
            <button
              key={task.id ?? 'none'}
              type="button"
              onClick={() => choose(task.id)}
              className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary/60 hover:bg-secondary/40"
            >
              <FileStack size={14} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="truncate font-medium">{task.name}</span>
                {/* Le département ne s'affiche que s'il apprend quelque chose : sur un
                    site ShotGrid, le nom de la tâche EST souvent celui de l'étape. */}
                {task.department && task.department !== task.name && (
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    <Layers size={10} className="mr-0.5 inline" />
                    {task.department}
                  </span>
                )}
              </span>
              <PipelineStatusBadge statusId={task.pipelineStatusId} scope="task" size="xs" />
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {t('asset.tree.versionCount', { count: task.versionCount })}
              </span>
            </button>
          ))}

          {allowNone && (
            <button
              type="button"
              onClick={() => choose(null)}
              className="w-full rounded-md border border-dashed border-border px-3 py-2 text-left text-sm text-muted-foreground hover:border-primary/60"
            >
              {t('upload.pickTask.none')}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
