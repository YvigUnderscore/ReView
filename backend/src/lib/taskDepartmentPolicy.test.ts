// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  canWriteTask,
  parseTaskPolicy,
  writableDepartments,
  type TaskWriteContext,
} from './taskDepartmentPolicy';

/** An animation artist (department 1), under the restricted policy. */
const artist = (over: Partial<TaskWriteContext> = {}): TaskWriteContext => ({
  policy: 'department',
  isManager: false,
  userDepartmentIds: [1],
  taskDepartmentId: 1,
  isAssignee: false,
  ...over,
});

describe('parseTaskPolicy', () => {
  it('falls back to "open": what ReView did before the rule existed', () => {
    expect(parseTaskPolicy(null)).toBe('open');
    expect(parseTaskPolicy('n’importe quoi')).toBe('open');
    expect(parseTaskPolicy('department')).toBe('department');
  });
});

describe('canWriteTask', () => {
  it('allows writing on a task of their department', () => {
    expect(canWriteTask(artist())).toBe(true);
  });

  it('rejects a task from another department', () => {
    expect(canWriteTask(artist({ taskDepartmentId: 2 }))).toBe(false);
  });

  it('allows writing on a task assigned to them, whatever its department', () => {
    // "If their department OR their profile does not have the task": the assignment is enough.
    expect(canWriteTask(artist({ taskDepartmentId: 2, isAssignee: true }))).toBe(true);
  });

  it('leaves a task without a department open, otherwise it would be unmodifiable', () => {
    // This is the case of a task created from a review feedback.
    expect(canWriteTask(artist({ taskDepartmentId: null }))).toBe(true);
  });

  it('never hinders a manager: intervening everywhere is their job', () => {
    expect(canWriteTask(artist({ isManager: true, taskDepartmentId: 9 }))).toBe(true);
  });

  it('widens nothing in open mode: the historical rule, the assignee and only them', () => {
    // Opening it here would give every artist control over all tasks of the project.
    expect(canWriteTask(artist({ policy: 'open', taskDepartmentId: 9 }))).toBe(false);
    expect(canWriteTask(artist({ policy: 'open', taskDepartmentId: 9, isAssignee: true }))).toBe(true);
  });

  it('rejects someone with no department at all', () => {
    expect(canWriteTask(artist({ userDepartmentIds: [] }))).toBe(false);
  });
});

describe('writableDepartments', () => {
  const pipe = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it("narrows the list to the person's steps: the promised readability", () => {
    expect(
      writableDepartments(pipe, { policy: 'department', isManager: false, userDepartmentIds: [2] }),
    ).toEqual([2]);
  });

  it('gives the whole pipeline to a manager', () => {
    expect(
      writableDepartments(pipe, { policy: 'department', isManager: true, userDepartmentIds: [2] }),
    ).toEqual([1, 2, 3]);
  });

  it('gives the whole pipeline when the policy is open', () => {
    expect(writableDepartments(pipe, { policy: 'open', isManager: false, userDepartmentIds: [] })).toEqual([
      1, 2, 3,
    ]);
  });
});
