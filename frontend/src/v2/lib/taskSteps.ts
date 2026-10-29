// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from 'react';
import { useSgConnection } from './shotgridApi';
import { useCreateTaskFromStep, useSgSteps } from './shotgridTasksApi';
import { useDepartments } from './departmentsApi';
import { useCreateTask } from './tasksApi';

/**
 * The steps a task can be born on, and how to create it there.
 *
 * Two repositories describe the same pipe: the site's when the project is linked to it,
 * the departments' otherwise. Screens do not need to know which one answers — they
 * ask for steps and get steps. This is what lets a standalone project
 * have tasks: until now the only creation gesture went through ShotGrid,
 * and a studio not linked to it had none.
 *
 * Both write paths live here for the same reason: they were copied into
 * the upload destination selector, and every new caller would have copied them
 * once more.
 */

export interface PickableStep {
  /** Identity on the screen side — never sent to the server. */
  key: string;
  code: string;
  color?: string | null;
  /** Filled in only for a step coming from the site. */
  sgId?: number;
}

export interface TaskStepsResult {
  /** True when the pipe is the site's: the task must then be born there. */
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
         : // Department policy: the list narrows to the steps where the person can
          // write — two entries rather than twelve. `writable` absent = old server
          // response, so nothing is hidden.
          (local.data ?? [])
            .filter((d) => d.writable !== false)
            .map((d) => ({ key: `dept-${d.id}`, code: d.key, color: d.color })),
    [linked, sg.data, local.data],
  );

  return { linked, steps, isLoading: linked ? sg.isLoading : local.isLoading };
}

export interface CreateStepTaskInput {
  /** `null` = task without a step — possible only outside a linked project. */
  step: PickableStep | null;
  parent: { kind: 'asset' | 'shot'; id: number };
  /** Proposed, never imposed: otherwise the step's code makes the name. */
  name?: string;
  /** Identifier on the site, when it is the site that holds the people. */
  assigneeSgId?: number | null;
  /** ReView identifier, on a standalone project. */
  assigneeId?: number | null;
}

/**
 * Creates the task where it must be born.
 *
 * On a linked project, in ShotGrid then pulled back: a task set locally would
 * duplicate at the next sync. Otherwise in ReView, on the chosen department.
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
