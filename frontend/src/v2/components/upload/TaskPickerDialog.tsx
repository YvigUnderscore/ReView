// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { Box, Clapperboard, FileStack, Layers, Loader2, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import PipelineStatusBadge from '../shotgrid/PipelineStatusBadge';
import { toast } from 'sonner';
import { useProjectTasks } from '../../lib/queries';
import { useCreateTaskFromStep, useSgProjectMembers, useSgSteps } from '../../lib/shotgridTasksApi';
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
  parent,
  allowNone,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tâches de l'entité ouverte, déjà connues de la page. */
  tasks: PickableTask[];
  projectId: number;
  /** L'entité sur laquelle créer la tâche manquante, si le projet est relié. */
  parent?: { kind: 'asset' | 'shot'; id: number };
  /** Permettre de rattacher la version au parent plutôt qu'à une tâche. */
  allowNone?: boolean;
  onPick: (taskId: number | null) => void;
}) {
  const t = useT();
  const [creating, setCreating] = useState<number | null>(null);
  // Le projet entier n'est demandé qu'une fois le dialogue ouvert : sur un gros projet,
  // ce n'est pas une liste à charger à chaque affichage de page.
  const { data: projectTasks = [] } = useProjectTasks(projectId, open);
  // Les étapes du site : elles existent avant toute tâche, et c'est ce qui manquait pour
  // déposer un rendu sur un asset neuf sans aller d'abord créer la tâche dans ShotGrid.
  const { data: steps = [] } = useSgSteps(
    projectId,
    parent?.kind === 'shot' ? 'Shot' : 'Asset',
    open && Boolean(parent),
  );
  const { data: members = [] } = useSgProjectMembers(projectId, open && Boolean(parent));
  const createTask = useCreateTaskFromStep(projectId);
  // Nom et personne à qui confier la tâche : proposés, jamais imposés. Le nom part du
  // code de l'étape — c'est la convention — mais un studio nomme parfois « model_hi »
  // là où l'étape s'appelle « modeling ».
  const [draftName, setDraftName] = useState('');
  const [assignee, setAssignee] = useState('');

  /**
   * Le reste du projet, du même bord seulement.
   *
   * Proposer les tâches d'un plan pendant qu'on dépose sur un asset — ou l'inverse —
   * n'offre pas un choix : cela range le rendu sous une entité qui n'a rien à voir, et
   * ShotGrid le reçoit au mauvais endroit.
   */
  const others = useMemo(() => {
    const known = new Set(tasks.map((task) => task.id));
    return projectTasks.filter((task) => !known.has(task.id) && (!parent || task.parentKind === parent.kind));
  }, [projectTasks, tasks, parent]);

  const choose = (taskId: number | null) => {
    onOpenChange(false);
    onPick(taskId);
  };

  /**
   * Étapes qu'aucune tâche de l'entité ne couvre encore.
   *
   * Toutes déroulées, sans recherche : la liste est celle du projet — celles que le
   * studio a déclarées, ou à défaut celles que ses tasks emploient — et elle tient à
   * l'écran. Chercher dans cinq lignes n'aide personne.
   */
  const freeSteps = useMemo(() => {
    const covered = new Set(tasks.map((task) => (task.department ?? task.name).toLowerCase()));
    return steps.filter((step) => !covered.has(step.code.toLowerCase()));
  }, [steps, tasks]);

  const createFromStep = async (step: { sgId: number; code: string }) => {
    if (!parent) return;
    setCreating(step.sgId);
    try {
      const r = await createTask.mutateAsync({
        stepSgId: step.sgId,
        parentType: parent.kind,
        parentId: parent.id,
        name: draftName.trim() || undefined,
        assigneeSgId: assignee ? Number(assignee) : null,
      });
      toast.success(t('upload.pickTask.created', { name: r.name }));
      choose(r.taskId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('upload.pickTask.createFailed'));
    } finally {
      setCreating(null);
    }
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

          {freeSteps.length > 0 && (
            <>
              <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('upload.pickTask.steps')}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  list="review-task-names"
                  placeholder={t('upload.pickTask.namePlaceholder')}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
                />
                {/* Les noms déjà employés ici : un pipe se lit mieux quand les tâches
                    d'un même asset portent des noms cohérents. */}
                <datalist id="review-task-names">
                  {[...new Set([...tasks.map((x) => x.name), ...projectTasks.map((x) => x.name)])].map(
                    (n) => (
                      <option key={n} value={n} />
                    ),
                  )}
                </datalist>
                <select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
                >
                  <option value="">{t('upload.pickTask.noAssignee')}</option>
                  {members.map((m) => (
                    <option key={m.sgId} value={m.sgId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          {freeSteps.map((step) => (
            <button
              key={step.sgId}
              type="button"
              disabled={creating !== null}
              onClick={() => void createFromStep(step)}
              className={`${ROW} disabled:opacity-50`}
            >
              {creating === step.sgId ? (
                <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Plus size={14} className="shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {t('upload.pickTask.createStep', { step: step.code })}
              </span>
              {step.color && (
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: step.color }} />
              )}
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
