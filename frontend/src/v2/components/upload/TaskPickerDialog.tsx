// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { Box, Clapperboard, FileStack, Layers, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import PipelineStatusBadge from '../shotgrid/PipelineStatusBadge';
import { useProjectTasks } from '../../lib/queries';
import { useT } from '../../i18n';

export interface PickableTask {
  id: number | null;
  name: string;
  department: string | null;
  pipelineStatusId?: number | null;
  versionCount: number;
}

const ROW =
  'flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary/60 hover:bg-secondary/40';

/**
 * À quelle tâche appartient cette version ?
 *
 * Jusqu'ici la destination était le contexte de navigation : une version créée depuis un
 * asset s'y accrochait directement, sans jamais passer par une tâche. Sur un projet
 * ShotGrid, où un asset traverse cinq étapes (art, model, rig, groom, lookdev) et chaque
 * plan autant, cela range un rendu de texturing à côté de l'asset plutôt que sous l'étape
 * qui l'a produit — et la version poussée vers le site arrive sans `sg_task`.
 *
 * Les tâches de l'entité ouverte viennent en premier : c'est le cas courant, et la page
 * les a déjà chargées. Tout le reste du projet suit, demandé à l'ouverture seulement,
 * pour pouvoir ranger un rendu sous n'importe quelle étape sans quitter la page.
 */
export default function TaskPickerDialog({
  open,
  onOpenChange,
  tasks,
  projectId,
  allowNone,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tâches de l'entité ouverte, déjà connues de la page. */
  tasks: PickableTask[];
  projectId: number;
  /** Permettre de rattacher la version au parent plutôt qu'à une tâche. */
  allowNone?: boolean;
  onPick: (taskId: number | null) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  // Le projet entier n'est demandé qu'une fois le dialogue ouvert : sur un gros projet,
  // ce n'est pas une liste à charger à chaque affichage de page.
  const { data: projectTasks = [] } = useProjectTasks(projectId, open);

  const others = useMemo(() => {
    const known = new Set(tasks.map((task) => task.id));
    const needle = query.trim().toLowerCase();
    return projectTasks
      .filter((task) => !known.has(task.id))
      .filter(
        (task) =>
          !needle ||
          task.name.toLowerCase().includes(needle) ||
          task.parentName.toLowerCase().includes(needle) ||
          (task.department ?? '').toLowerCase().includes(needle),
      );
  }, [projectTasks, query, tasks]);

  const choose = (taskId: number | null) => {
    onOpenChange(false);
    setQuery('');
    onPick(taskId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('upload.pickTask.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('upload.pickTask.hint')}</p>

        {projectTasks.length > tasks.length && (
          <label className="mt-2 flex items-center gap-2 rounded-md border border-input bg-background px-2">
            <Search size={13} className="shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('upload.pickTask.search')}
              className="w-full bg-transparent py-1.5 text-sm outline-none"
            />
          </label>
        )}

        <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">
          {tasks.map((task) => (
            <button key={task.id ?? 'none'} type="button" onClick={() => choose(task.id)} className={ROW}>
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

          {others.length > 0 && (
            <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('upload.pickTask.elsewhere')}
            </p>
          )}
          {others.map((task) => (
            <button key={task.id} type="button" onClick={() => choose(task.id)} className={ROW}>
              {task.parentKind === 'shot' ? (
                <Clapperboard size={14} className="shrink-0 text-muted-foreground" />
              ) : (
                <Box size={14} className="shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className="text-muted-foreground">{task.parentName} · </span>
                <span className="truncate font-medium">{task.name}</span>
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
