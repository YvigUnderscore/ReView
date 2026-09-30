// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from 'react';
import { useSgConnection } from './shotgridApi';
import { useCreateTaskFromStep, useSgSteps } from './shotgridTasksApi';
import { useDepartments } from './departmentsApi';
import { useCreateTask } from './tasksApi';

/**
 * Les étapes sur lesquelles une tâche peut naître, et la façon de l'y créer.
 *
 * Deux référentiels décrivent le même pipe : celui du site quand le projet y est relié,
 * celui des départements sinon. Les écrans n'ont pas à savoir lequel répond — ils
 * demandent des étapes et obtiennent des étapes. C'est ce qui permet à un projet
 * autonome d'avoir des tasks : jusqu'ici le seul geste de création passait par ShotGrid,
 * et un studio qui ne s'y relie pas n'en avait aucun.
 *
 * Les deux chemins d'écriture vivent ici pour la même raison : ils étaient recopiés dans
 * le sélecteur de destination d'upload, et tout nouvel appelant les aurait recopiés une
 * fois de plus.
 */

export interface PickableStep {
  /** Identité côté écran — jamais envoyée au serveur. */
  key: string;
  code: string;
  color?: string | null;
  /** Renseigné seulement pour une étape venue du site. */
  sgId?: number;
}

export interface TaskStepsResult {
  /** Vrai quand le pipe est celui du site : la tâche doit alors y naître. */
  linked: boolean;
  steps: PickableStep[];
  isLoading: boolean;
}

export function useTaskSteps(
  projectId: number,
  parentKind: 'asset' | 'shot',
  enabled = true,
): TaskStepsResult {
  const { data: connection } = useSgConnection(projectId);
  const linked = Boolean(connection?.active);
  const sg = useSgSteps(projectId, parentKind === 'shot' ? 'Shot' : 'Asset', enabled && linked);
  const local = useDepartments(projectId, enabled && !linked);

  const steps = useMemo<PickableStep[]>(
    () =>
      linked
        ? (sg.data ?? []).map((s) => ({ key: `sg-${s.sgId}`, code: s.code, color: s.color, sgId: s.sgId }))
        : // Politique de département : la liste se réduit aux étapes où la personne peut
          // écrire — deux entrées plutôt que douze. `writable` absent = ancienne réponse
          // du serveur, on ne masque alors rien.
          (local.data ?? [])
            .filter((d) => d.writable !== false)
            .map((d) => ({ key: `dept-${d.id}`, code: d.key, color: d.color })),
    [linked, sg.data, local.data],
  );

  return { linked, steps, isLoading: linked ? sg.isLoading : local.isLoading };
}

export interface CreateStepTaskInput {
  /** `null` = tâche sans étape — possible seulement hors projet relié. */
  step: PickableStep | null;
  parent: { kind: 'asset' | 'shot'; id: number };
  /** Proposé, jamais imposé : à défaut, le code de l'étape fait le nom. */
  name?: string;
  /** Identifiant du site, quand c'est lui qui tient les personnes. */
  assigneeSgId?: number | null;
  /** Identifiant ReView, sur un projet autonome. */
  assigneeId?: number | null;
}

/**
 * Crée la tâche là où elle doit naître.
 *
 * Sur un projet relié, dans ShotGrid puis rapatriée : une tâche posée localement ferait
 * doublon à la synchronisation suivante. Sinon dans ReView, sur le département choisi.
 */
export function useCreateStepTask(projectId: number) {
  const fromStep = useCreateTaskFromStep(projectId);
  const local = useCreateTask(projectId);

  return async (input: CreateStepTaskInput): Promise<{ taskId: number; name: string }> => {
    if (input.step?.sgId !== undefined) {
      const created = await fromStep.mutateAsync({
        stepSgId: input.step.sgId,
        parentType: input.parent.kind,
        parentId: input.parent.id,
        name: input.name?.trim() || undefined,
        assigneeSgId: input.assigneeSgId ?? null,
      });
      return { taskId: created.taskId, name: created.name };
    }
    const { task } = await local.mutateAsync({
      name: input.name?.trim() || input.step?.code || '',
      department: input.step?.code ?? null,
      assigneeId: input.assigneeId ?? null,
      ...(input.parent.kind === 'shot' ? { shotId: input.parent.id } : { assetId: input.parent.id }),
    });
    return { taskId: task.id, name: task.name };
  };
}
