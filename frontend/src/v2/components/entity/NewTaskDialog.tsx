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

/** Valeur du select quand aucune étape n'est visée — hors projet relié seulement. */
const NO_STEP = 'none';

/**
 * Créer une tâche sur un plan ou un asset.
 *
 * ReView savait créer des tâches depuis toujours, mais aucun écran ne le proposait : on y
 * arrivait par la bande, en demandant une nouvelle version ou en assignant quelqu'un. Un
 * studio qui ne relie pas ses projets à ShotGrid n'avait donc pas de pipe du tout, alors
 * que rien dans le modèle ne l'exige.
 *
 * Le dialogue ignore la provenance des étapes (`useTaskSteps`) : le site quand le projet
 * y est relié — la tâche y naît alors, sinon la synchronisation suivante en verrait deux —
 * les départements du projet autrement. Aucune étape déclarée n'est pas un cul-de-sac :
 * une tâche sans étape reste une tâche, et se range en fourre-tout jusqu'à ce que le pipe
 * existe.
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
  /** Appelé après création — la page décide si elle recharge ou si elle ouvre la tâche. */
  onCreated?: (taskId: number) => void;
}) {
  const t = useT();
  const { linked, steps } = useTaskSteps(projectId, parent.kind, open);
  const createTask = useCreateStepTask(projectId);
  // Les personnes viennent d'où viennent les tâches : le site tient ses propres comptes,
  // et une tâche créée là-bas s'assigne avec un identifiant du site.
  const members = useProjectMembers(projectId);
  const { data: sgMembers = [] } = useSgProjectMembers(projectId, open && linked);
  const people = linked
    ? sgMembers.map((m) => ({ id: m.sgId, name: m.name }))
    : members.map((m) => ({ id: m.id, name: m.name }));

  const [stepKey, setStepKey] = useState('');
  const [name, setName] = useState('');
  const [assignee, setAssignee] = useState('');
  const [saving, setSaving] = useState(false);

  // Le premier choix par défaut, sans écraser celui qu'on vient de faire : sur un projet
  // relié, « sans étape » n'existe pas — la tâche doit porter une étape du site.
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
              {/* Sans étape : possible seulement quand le pipe est celui de ReView. */}
              {!linked && <option value={NO_STEP}>{t('pipeline.dept.none')}</option>}
            </Select>
            {/* Un site injoignable rendait un select vide et un bouton inerte, sans un mot
                pour dire pourquoi. Hors projet relié, « sans étape » sauve toujours la mise. */}
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
              // Le nom part du code de l'étape — c'est la convention — mais un studio
              // nomme parfois « model_hi » là où l'étape s'appelle « modeling ».
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
              {/* « Personne » nommerait à la fois le champ et son absence de valeur en
                  français : le libellé de l'option dit donc l'état, pas le rôle. */}
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
