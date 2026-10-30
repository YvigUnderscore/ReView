// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { FileStack, Layers, Loader2, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import PipelineStatusBadge from '../shotgrid/PipelineStatusBadge';
import { toast } from 'sonner';
import { useProjectTasks } from '../../lib/queries';
import { useSgProjectMembers } from '../../lib/shotgridTasksApi';
import { useCreateStepTask, useTaskSteps, type PickableStep } from '../../lib/taskSteps';
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

/** Wait key of the stepless task: the others are `sg-<id>` or `dept-<id>`. */
const STEPLESS_KEY = 'stepless';

/**
 * Which task does this version belong to?
 *
 * Until now the destination was the navigation context: a version created from an asset
 * attached itself directly to it, never going through a task. On a ShotGrid project, where an
 * asset goes through five steps (art, model, rig, groom, lookdev) and each shot as many,
 * this filed a texturing render next to the asset rather than under the step that produced
 * it — and the version pushed to the site arrived without `sg_task`.
 *
 * The dialog always opens FROM an entity, and only offers that entity's tasks. It once listed
 * the rest of the project — from the same side, asset or shot — to file a render under any
 * step without leaving the page. A false convenience: you drop onto the entity you are
 * looking at, and a version filed under another asset goes to the site in the wrong place,
 * which cannot be undone. If the step is missing, it is created right here, on the open entity.
 *
 * It must still never leave the user without an exit: when the entity has no task and the
 * pipeline offers no step to propose, the dialog explains why and lets the user create a task
 * WITHOUT a step (see `barren` / `stepless`). An empty box made the drop impossible.
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
  /** Tasks of the open entity, already known to the page. */
  tasks: PickableTask[];
  projectId: number;
  /**
   * The entity the dialog is opened from: the only possible destination, and the one that
   * will carry the task created on the fly. Required — a drop without a known entity does
   * not exist, and the type forbids bringing back the whole project list.
   */
  parent: { kind: 'asset' | 'shot'; id: number };
  /**
   * Allow attaching the version to the parent rather than to a task.
   *
   * **Reserved for an asset.** A version hangs off a task OR an asset, never a shot: the
   * database enforces it (`CHECK Version_parent_xor`, `num_nonnulls(taskId, assetId) = 1`), and
   * `ShotPage` in fact refuses a null `taskId`. Setting it on a shot for symmetry would
   * therefore only open a button with no effect — on a shot, the exit is `stepless`.
   */
  allowNone?: boolean;
  onPick: (taskId: number | null) => void;
}) {
  const t = useT();
  const [creating, setCreating] = useState<string | null>(null);
  // The project's tasks no longer serve as destinations — only to suggest names already
  // used. Requested on opening only: on a large project, it is not a list to load on every page render.
  const { data: projectTasks = [] } = useProjectTasks(projectId, open);
  // The pipeline steps, wherever they come from: the site on a linked project — they exist
  // there before any task, which is what was missing to drop a render on a new asset — the
  // project's departments otherwise (B2).
  const { linked, steps, isLoading } = useTaskSteps(projectId, parent.kind, open);
  const { data: members = [] } = useSgProjectMembers(projectId, open && linked);
  const createTask = useCreateStepTask(projectId);
  // Name and person to assign the task to: suggested, never imposed. The name comes from the
  // step's code — that is the convention — but a studio sometimes names "model_hi" where the
  // step is called "modeling".
  const [draftName, setDraftName] = useState('');
  const [assignee, setAssignee] = useState('');

  const choose = (taskId: number | null) => {
    onOpenChange(false);
    onPick(taskId);
  };

  /**
   * Steps that no task of the entity covers yet.
   *
   * All listed, without search: the list is the project's — the ones the studio declared, or
   * failing that the ones its tasks use — and it fits on screen. Searching five rows helps no one.
   */
  const freeSteps = useMemo(() => {
    const covered = new Set(tasks.map((task) => (task.department ?? task.name).toLowerCase()));
    return steps.filter((step) => !covered.has(step.code.toLowerCase()));
  }, [steps, tasks]);

  /**
   * Nothing to choose and nothing to create: the dialog would be an empty box, and the drop
   * impossible.
   *
   * The case is reachable, and not only in an exotic configuration: nothing seeds a department
   * at installation, so a studio that never declared one has NONE; the department policy only
   * leaves a step writable to whoever belongs to one of them; a linked site may expose nothing
   * for this kind of entity. On a fresh entity only the modal's close button was left, and the
   * media stayed on the desktop. The whole project's list served as the emergency exit — it
   * filed in the wrong place, which cannot be undone.
   */
  const barren = !isLoading && tasks.length === 0 && freeSteps.length === 0;
  /**
   * The real exit: a task WITHOUT a step, on the open entity. The server accepts it from any
   * contributor — the department policy is only checked when a step is set (`TaskService.create`) —
   * and it files the version in the right place.
   *
   * Never on a linked project: a task born in ReView would duplicate on the next sync. There,
   * it is up to the site to declare the step; the dialog says so.
   */
  const stepless = barren && !linked;
  // Without a step, the name can no longer fall back to its code: it becomes mandatory, and
  // the field label must stop promising a default that does not exist.
  const namePrompt = stepless ? t('upload.pickTask.nameRequired') : t('upload.pickTask.namePlaceholder');

  const createFromStep = async (step: PickableStep | null) => {
    setCreating(step?.key ?? STEPLESS_KEY);
    try {
      // The task is born in ShotGrid or in ReView depending on the chosen step — `useCreateStepTask`
      // decides, the dialog does not need to know both paths.
      const created = await createTask({
        step,
        parent,
        name: draftName,
        assigneeSgId: assignee ? Number(assignee) : null,
      });
      // The message only mentions ShotGrid when the task was really created there: on a
      // standalone project, announcing a remote write would be false.
      toast.success(
        step?.sgId !== undefined
          ? t('upload.pickTask.created', { name: created.name })
          : t('task.createdNamed', { name: created.name }),
      );
      choose(created.taskId);
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
        {/* The help text mentioned ShotGrid to everyone, including on a standalone project. */}
        <p className="text-sm text-muted-foreground">
          {linked ? t('upload.pickTask.hint') : t('upload.pickTask.hintLocal')}
        </p>

        <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">
          {tasks.map((task) => (
            <button key={task.id ?? 'none'} type="button" onClick={() => choose(task.id)} className={ROW}>
              <FileStack size={14} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="truncate font-medium">{task.name}</span>
                {/* The department is only shown if it adds information: on a ShotGrid site, the
                    task's name is often the step's name. */}
                {task.department && task.department !== task.name && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    <Layers size={10} className="mr-0.5 inline" />
                    {task.department}
                  </span>
                )}
              </span>
              <PipelineStatusBadge statusId={task.pipelineStatusId} scope="task" size="xs" />
              <span className="shrink-0 text-xs text-muted-foreground">
                {t('asset.tree.versionCount', { count: task.versionCount })}
              </span>
            </button>
          ))}

          {/* The pipeline is loading: saying "nothing to choose" before its response would be false. */}
          {isLoading && <p className="px-1 py-2 text-sm text-muted-foreground">{t('common.loading')}</p>}

          {/* The empty box is explained, and says what is left to do to drop anyway. */}
          {barren && (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
              {stepless ? t('upload.pickTask.barren') : t('upload.pickTask.barrenLinked')}
            </p>
          )}

          {(freeSteps.length > 0 || stepless) && (
            <>
              <p className="pt-2 text-xs font-semibold section-label text-muted-foreground">
                {t('upload.pickTask.steps')}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  list="review-task-names"
                  placeholder={namePrompt}
                  aria-label={namePrompt}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
                {/* Names already used — here and elsewhere in the project. A name is not a
                    destination: the studio's convention is read across the whole project
                    ("model_hi" where the step is called "modeling"), whereas the version
                    can only be filed under the open entity. */}
                <datalist id="review-task-names">
                  {[...new Set([...tasks.map((x) => x.name), ...projectTasks.map((x) => x.name)])].map(
                    (n) => (
                      <option key={n} value={n} />
                    ),
                  )}
                </datalist>
                <select
                  aria-label={t('task.new.assignee')}
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  disabled={members.length === 0}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-50"
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
              key={step.key}
              type="button"
              disabled={creating !== null}
              onClick={() => void createFromStep(step)}
              className={`${ROW} disabled:opacity-50`}
            >
              {creating === step.key ? (
                <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Plus size={14} className="shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {/* The label only promises ShotGrid when the task will really be created there. */}
                {step.sgId !== undefined
                  ? t('upload.pickTask.createStep', { step: step.code })
                  : t('upload.pickTask.createStepLocal', { step: step.code })}
              </span>
              {step.color && (
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: step.color }} />
              )}
            </button>
          ))}

          {stepless && (
            <button
              type="button"
              // Without a step to take the name from, an empty name would make a task the server
              // refuses: the button waits for one to be given.
              disabled={creating !== null || draftName.trim() === ''}
              onClick={() => void createFromStep(null)}
              className={`${ROW} disabled:opacity-50`}
            >
              {creating === STEPLESS_KEY ? (
                <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Plus size={14} className="shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{t('upload.pickTask.createStepless')}</span>
            </button>
          )}

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
