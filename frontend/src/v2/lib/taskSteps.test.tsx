// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCreateStepTask, useTaskSteps } from './taskSteps';

const { connection, sgSteps, departments, fromStep, local } = vi.hoisted(() => ({
  connection: vi.fn(),
  sgSteps: vi.fn(),
  departments: vi.fn(),
  fromStep: vi.fn(),
  local: vi.fn(),
}));

vi.mock('./shotgridApi', () => ({ useSgConnection: connection }));
vi.mock('./shotgridTasksApi', () => ({
  useSgSteps: sgSteps,
  useCreateTaskFromStep: () => ({ mutateAsync: fromStep }),
}));
vi.mock('./departmentsApi', () => ({ useDepartments: departments }));
vi.mock('./tasksApi', () => ({ useCreateTask: () => ({ mutateAsync: local }) }));

beforeEach(() => {
  vi.clearAllMocks();
  connection.mockReturnValue({ data: null });
  sgSteps.mockReturnValue({ data: [], isLoading: false });
  departments.mockReturnValue({ data: [], isLoading: false });
  fromStep.mockResolvedValue({ taskId: 5, sgId: 900, name: 'Animation' });
  local.mockResolvedValue({ task: { id: 6, name: 'ANIM', department: 'ANIM' } });
});

/**
 * A standalone project has a pipe: its departments. Screens nevertheless read it
 * through ShotGrid, so an unlinked studio had no step to offer — and therefore
 * no task to create.
 */
describe('useTaskSteps', () => {
  it('serves the project departments when no site drives it', () => {
    departments.mockReturnValue({
      data: [
        { id: 1, key: 'ANIM', color: '#111', writable: true },
        { id: 2, key: 'COMP', color: null, writable: true },
      ],
      isLoading: false,
    });
    const { result } = renderHook(() => useTaskSteps(3, 'shot'));
    expect(result.current.linked).toBe(false);
    expect(result.current.steps).toEqual([
      { key: 'dept-1', code: 'ANIM', color: '#111' },
      { key: 'dept-2', code: 'COMP', color: null },
    ]);
  });

  it('drops steps the person cannot write to, and keeps old responses', () => {
    departments.mockReturnValue({
      data: [
        { id: 1, key: 'ANIM', color: null, writable: false },
        { id: 2, key: 'COMP', color: null },
      ],
      isLoading: false,
    });
    const { result } = renderHook(() => useTaskSteps(3, 'asset'));
    expect(result.current.steps.map((s) => s.code)).toEqual(['COMP']);
  });

  it('serves the site catalogue as soon as the project is linked to it', () => {
    connection.mockReturnValue({ data: { active: true } });
    sgSteps.mockReturnValue({
      data: [{ sgId: 4, code: 'Animation', shortName: 'anm', color: '#0f0', order: 1, used: true }],
      isLoading: false,
    });
    const { result } = renderHook(() => useTaskSteps(3, 'shot'));
    expect(result.current.linked).toBe(true);
    expect(result.current.steps).toEqual([{ key: 'sg-4', code: 'Animation', color: '#0f0', sgId: 4 }]);
    // The side matters: a shot step is not an asset step.
    expect(sgSteps).toHaveBeenCalledWith(3, 'Shot', true);
  });
});

describe('useCreateStepTask', () => {
  it('creates in ReView on a standalone project, on the chosen department', async () => {
    const { result } = renderHook(() => useCreateStepTask(3));
    const created = await result.current({
      step: { key: 'dept-1', code: 'ANIM' },
      parent: { kind: 'shot', id: 12 },
      assigneeId: 8,
    });
    expect(local).toHaveBeenCalledWith({
      name: 'ANIM',
      department: 'ANIM',
      assigneeId: 8,
      shotId: 12,
    });
    expect(fromStep).not.toHaveBeenCalled();
    expect(created).toEqual({ taskId: 6, name: 'ANIM' });
  });

  it('accepts a task without a step — it lands in the catch-all', async () => {
    const { result } = renderHook(() => useCreateStepTask(3));
    await result.current({ step: null, parent: { kind: 'asset', id: 4 }, name: 'Retake client' });
    expect(local).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Retake client', department: null, assetId: 4 }),
    );
  });

  /**
   * The project's invariant: on a project driven from ShotGrid, the task is born there.
   * A task set locally would duplicate at the next sync.
   */
  it('goes through the site as soon as the step comes from it', async () => {
    const { result } = renderHook(() => useCreateStepTask(3));
    const created = await result.current({
      step: { key: 'sg-4', code: 'Animation', sgId: 4 },
      parent: { kind: 'asset', id: 9 },
      assigneeSgId: 91,
    });
    expect(fromStep).toHaveBeenCalledWith({
      stepSgId: 4,
      parentType: 'asset',
      parentId: 9,
      name: undefined,
      assigneeSgId: 91,
    });
    expect(local).not.toHaveBeenCalled();
    expect(created).toEqual({ taskId: 5, name: 'Animation' });
  });
});
