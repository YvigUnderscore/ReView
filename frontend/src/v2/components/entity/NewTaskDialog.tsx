// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select } from '../ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { useProjectMembers } from '../../lib/useProjectRole';
import { useSgProjectMembers } from '../../lib/shotgridTasksApi';
import { useCreateStepTask, useTaskSteps } from '../../lib/taskSteps';
import { useT } from '../../i18n';

/** Value of the select when no step is targeted: only outside a linked project. */
const NO_STEP = 'none';

/**
 * Create a task on a shot or an asset.
 *
 * ReView has always been able to create tasks, but no screen offered it: one reached it sideways, by requesting a new
 * version or by assigning someone. A studio that does not link its projects to ShotGrid therefore had no pipe at all,
 * although nothing in the model requires one.
 *
 * The dialog ignores where the steps come from (`useTaskSteps`): the site when the project is linked to it, in which
 * case the task is born there (otherwise the next sync would see two), and otherwise the project's departments. No
 * declared step is not a dead end: a task without a step remains a task, and is filed in a catch-all until the pipe
 * exists.
 */
export default function NewTaskDialog({
  open,
  onOpenChange,
  projectId,
  parent,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  parent: { kind: 'asset' | 'shot'; id: number };
  /** Called after creation: the page decides whether to reload or to open the task. */
  onCreated?: (taskId: number) => void;
}) {
  const t = useT();
  const { linked, steps } = useTaskSteps(projectId, parent.kind, open);
  const createTask = useCreateStepTask(projectId);
  // People come from where the tasks come from: the site keeps its own accounts, and a task created there
  // is assigned with a site identifier.
  const members = useProjectMembers(projectId);
  const { data: sgMembers = [] } = useSgProjectMembers(projectId, open && linked);
  const people = linked
    ? sgMembers.map((m) => ({ id: m.sgId, name: m.name }))
    : members.map((m) => ({ id: m.id, name: m.name }));

  const [stepKey, setStepKey] = useState('');
  const [name, setName] = useState('');
  const [assignee, setAssignee] = useState('');
  const [saving, setSaving] = useState(false);

  // The first default choice, without overriding the one just made: on a linked project, "no step" does not
  // exist, since the task must carry a site step.
  const selected = stepKey || (steps[0]?.key ?? (linked ? '' : NO_STEP));
  const step = steps.find((s) => s.key === selected) ?? null;

  const close = () => {
    onOpenChange(false);
    setStepKey('');
    setName('');
    setAssignee('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await createTask({
        step,
        parent,
        name,
        ...(linked ? { assigneeSgId: assignee ? Number(assignee) : null } : {}),
        ...(linked ? {} : { assigneeId: assignee ? Number(assignee) : null }),
      });
      toast.success(t('task.createdNamed', { name: created.name }));
      close();
      onCreated?.(created.taskId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('upload.pickTask.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <DialogHeader>
            <DialogTitle>{t('task.new')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {linked ? t('task.new.hintShotgrid') : t('task.new.hint')}
          </p>

          <div className="space-y-1">
            <Label>{t('task.new.step')}</Label>
            <Select
              className="w-full"
              value={selected}
              aria-label={t('task.new.step')}
              onChange={(e) => setStepKey(e.target.value)}
            >
              {steps.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.code}
                </option>
              ))}
              {/* No step: only possible when the pipe is ReView's. */}
              {!linked && <option value={NO_STEP}>{t('pipeline.dept.none')}</option>}
            </Select>
            {/* An unreachable site rendered an empty select and an inert button, without a word to say why.
                Outside a linked project, "no step" always saves the day. */}
            {linked && steps.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('task.new.noSteps')}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label>{t('common.name')}</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              // The name comes from the step code, which is the convention, but a studio sometimes names
              // "model_hi" where the step is called "modeling".
              placeholder={step ? step.code : t('upload.pickTask.namePlaceholder')}
              aria-label={t('common.name')}
              required={step === null}
            />
          </div>

          <div className="space-y-1">
            <Label>{t('task.new.assignee')}</Label>
            <Select
              className="w-full"
              value={assignee}
              aria-label={t('task.new.assignee')}
              onChange={(e) => setAssignee(e.target.value)}
              disabled={people.length === 0}
            >
              {/* "Nobody" would name both the field and its absence of value: the option's label therefore
                  states the state, not the role. */}
              <option value="">{t('upload.pickTask.noAssignee')}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={saving || (linked && step === null)}>
              {t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
