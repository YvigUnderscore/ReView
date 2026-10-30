// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A1-05: the three assignment paths refuse the same people.
 *
 * `EntityAssigneeService.assertAssignable` refuses a service account, a deactivated account and someone who does
 * not contribute to the project; entity assignment and review assignment both call it. Tasks, however, wrote
 * `assigneeId` as is: on creation, through `setAssignee` (batch and right-click path), through `update`, and through
 * the v1 API. These tests pin the four paths to the common guard: without it, they write to the database and
 * notify someone outside the project.
 */
vi.mock('../lib/prisma', () => ({
  prisma: {
    task: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    setting: { findUnique: vi.fn().mockResolvedValue(null) },
    user: { findUnique: vi.fn().mockResolvedValue({ departments: [] }) },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn() }));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));
vi.mock('./DepartmentService', () => ({ resolveByKey: vi.fn(() => Promise.resolve(null)) }));
vi.mock('./PipelineStatusService', () => ({
  listForProject: vi.fn(() => Promise.resolve([])),
  resolveByLegacy: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectRoles', () => ({
  assertCanContribute: vi.fn(),
  assertProjectManage: vi.fn(),
  isProjectManager: vi.fn(() => Promise.resolve(true)),
}));

const { assertAssignable } = vi.hoisted(() => ({ assertAssignable: vi.fn() }));
vi.mock('./EntityAssigneeService', () => ({ assertAssignable }));

import { create, setAssignee, update, applyApiPatch } from './TaskService';
import { prisma } from '../lib/prisma';
import { notify } from './NotificationService';
import { badRequest } from '../lib/errors';
import { Role, TaskStatus, TaskType } from '@prisma/client';

const supervisor = { id: 2, role: Role.SUPERVISOR };
const PROJECT = 3;
const OUTSIDER = 77;

const taskRow = {
  id: 1,
  name: 'comp',
  type: TaskType.COMPOSITING,
  department: 'comp',
  status: TaskStatus.IN_PROGRESS,
  order: 0,
  startDate: null,
  dueDate: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  assignee: null,
  shot: { id: 7, code: 'sh010', projectId: PROJECT, project: { slug: 'film' }, sequence: { code: 'sq01' } },
  asset: null,
};

/** What the common guard returns for someone who is not on the project. */
const refuse = () =>
  assertAssignable.mockRejectedValue(
    badRequest('This person cannot be assigned work on this project', 'NOT_ASSIGNABLE'),
  );

beforeEach(() => {
  vi.clearAllMocks();
  assertAssignable.mockResolvedValue(undefined);
  vi.mocked(prisma.task.create).mockResolvedValue({ id: 1, name: 'comp', shotId: 7, assetId: null } as never);
  vi.mocked(prisma.task.update).mockResolvedValue({ ...taskRow, shotId: 7, assetId: null } as never);
  vi.mocked(prisma.task.findUnique).mockResolvedValue({
    assigneeId: null,
    status: TaskStatus.TODO,
    pipelineStatusId: null,
    departmentId: null,
  } as never);
});

describe('TaskService: assignment subject to the common guard (A1-05)', () => {
  it('create: refuses and writes nothing', async () => {
    refuse();
    await expect(
      create(supervisor, PROJECT, {
        name: 'comp',
        type: TaskType.COMPOSITING,
        shotId: 7,
        assigneeId: OUTSIDER,
      }),
    ).rejects.toThrow(/cannot be assigned/);
    expect(assertAssignable).toHaveBeenCalledWith(PROJECT, [OUTSIDER]);
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('setAssignee: refuses and writes nothing (batch and right-click path)', async () => {
    refuse();
    await expect(setAssignee(supervisor, PROJECT, 1, OUTSIDER)).rejects.toThrow(/cannot be assigned/);
    expect(assertAssignable).toHaveBeenCalledWith(PROJECT, [OUTSIDER]);
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('update: refuses and writes nothing', async () => {
    refuse();
    await expect(update(supervisor, PROJECT, 1, { assigneeId: OUTSIDER })).rejects.toThrow(
      /cannot be assigned/,
    );
    expect(assertAssignable).toHaveBeenCalledWith(PROJECT, [OUTSIDER]);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('applyApiPatch (v1): refuses and writes nothing', async () => {
    refuse();
    await expect(applyApiPatch(supervisor.id, PROJECT, 1, { assigneeId: OUTSIDER })).rejects.toThrow(
      /cannot be assigned/,
    );
    expect(assertAssignable).toHaveBeenCalledWith(PROJECT, [OUTSIDER]);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('unassigning does not consult the guard: `null` is nobody', async () => {
    await setAssignee(supervisor, PROJECT, 1, null);
    expect(assertAssignable).not.toHaveBeenCalled();
    expect(prisma.task.update).toHaveBeenCalled();
  });

  it('an acceptable assignee passes, on all four paths', async () => {
    await create(supervisor, PROJECT, { name: 'comp', type: TaskType.COMPOSITING, shotId: 7, assigneeId: 4 });
    await setAssignee(supervisor, PROJECT, 1, 4);
    await update(supervisor, PROJECT, 1, { assigneeId: 4 });
    await applyApiPatch(supervisor.id, PROJECT, 1, { assigneeId: 4 });
    expect(assertAssignable).toHaveBeenCalledTimes(4);
    expect(assertAssignable).toHaveBeenLastCalledWith(PROJECT, [4]);
  });
});
