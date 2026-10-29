// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The change stream only came from the v1 API: a status set by right-click, a batch assignment or a task created on
 * screen produced neither a journal line nor a webhook. These tests pin the opposite: the origin of the change no longer
 * matters, and the distinction that matters to a consumer: a status change is an event of its own, not an "update" to
 * compare oneself.
 */
vi.mock('../lib/prisma', () => ({
  prisma: {
    task: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    comment: { findUnique: vi.fn() },
        // Department policy (studio setting): absent = "open", the historical rule.
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
// Assignment guard (A1-05): its content is tested in `TaskService.assignable.test.ts`; here we only want to let
// the assignments of these event scenarios through.
vi.mock('./EntityAssigneeService', () => ({ assertAssignable: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectRoles', () => ({
  assertCanContribute: vi.fn(),
  assertProjectManage: vi.fn(),
  isProjectManager: vi.fn(() => Promise.resolve(true)),
}));

import { create, setAssignee, update } from './TaskService';
import { prisma } from '../lib/prisma';
import { publish } from './ApiEventService';
import { Role, TaskStatus, TaskType } from '@prisma/client';

const supervisor = { id: 2, role: Role.SUPERVISOR };

/** Row in `taskSelect` format: `toTask` needs the parent to build the path. */
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
  shot: { id: 7, code: 'sh010', projectId: 3, project: { slug: 'film' }, sequence: { code: 'sq01' } },
  asset: null,
};

const eventsSent = () => vi.mocked(publish).mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.task.update).mockResolvedValue({
    id: 1,
    name: 'comp',
    shotId: 7,
    assetId: null,
    status: TaskStatus.IN_PROGRESS,
    pipelineStatusId: null,
    assigneeId: null,
  } as never);
});

describe('TaskService.update: change stream', () => {
  it('distinguishes a status change from an update', async () => {
    vi.mocked(prisma.task.findUnique)
      .mockResolvedValueOnce({ assigneeId: null, status: TaskStatus.TODO, pipelineStatusId: null } as never)
      .mockResolvedValueOnce(taskRow as never);

    await update(supervisor, 3, 1, { status: TaskStatus.IN_PROGRESS });

    expect(eventsSent()).toEqual(['task.status_changed', 'task.updated']);
    expect(vi.mocked(publish).mock.calls[0]![1]).toMatchObject({
      projectId: 3,
      entityType: 'task',
      entityId: 1,
      actorId: 2,
      payload: { from: TaskStatus.TODO, to: TaskStatus.IN_PROGRESS },
    });
  });

  it('does not announce a status change when nothing moved', async () => {
    vi.mocked(prisma.task.findUnique)
      .mockResolvedValueOnce({
        assigneeId: null,
        status: TaskStatus.IN_PROGRESS,
        pipelineStatusId: null,
      } as never)
      .mockResolvedValueOnce(taskRow as never);

    await update(supervisor, 3, 1, { name: 'comp 2' });

    expect(eventsSent()).toEqual(['task.updated']);
  });

  it('announces the assignment when it really changes', async () => {
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: 1,
      name: 'comp',
      shotId: 7,
      assetId: null,
      status: TaskStatus.IN_PROGRESS,
      pipelineStatusId: null,
      assigneeId: 9,
    } as never);
    vi.mocked(prisma.task.findUnique)
      .mockResolvedValueOnce({
        assigneeId: null,
        status: TaskStatus.IN_PROGRESS,
        pipelineStatusId: null,
      } as never)
      .mockResolvedValueOnce(taskRow as never);

    await update(supervisor, 3, 1, { assigneeId: 9 });

    expect(eventsSent()).toEqual(['task.assigned', 'task.updated']);
    expect(vi.mocked(publish).mock.calls[0]![1]).toMatchObject({
      payload: { assigneeId: 9, from: null },
    });
  });

  it('carries the API representation in the payload: the same as for a v1 call', async () => {
    vi.mocked(prisma.task.findUnique)
      .mockResolvedValueOnce({
        assigneeId: null,
        status: TaskStatus.IN_PROGRESS,
        pipelineStatusId: null,
      } as never)
      .mockResolvedValueOnce(taskRow as never);

    await update(supervisor, 3, 1, { name: 'comp 2' });

    const payload = (vi.mocked(publish).mock.calls[0]![1] as { payload: { task: { path: string } } }).payload;
    expect(payload.task.path).toBe('film/sq01/sh010/comp');
  });
});

describe('TaskService.setAssignee: assignment (including batch)', () => {
  beforeEach(() => {
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: 1,
      name: 'comp',
      shotId: 7,
      assetId: null,
    } as never);
  });

  it('publishes the assignment and the update', async () => {
    vi.mocked(prisma.task.findUnique)
      .mockResolvedValueOnce({ assigneeId: null } as never)
      .mockResolvedValueOnce(taskRow as never);

    await setAssignee(supervisor, 3, 1, 9);

    expect(eventsSent()).toEqual(['task.assigned', 'task.updated']);
  });

  it('stays silent when the assignee does not change', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce({ assigneeId: 9 } as never);
    await setAssignee(supervisor, 3, 1, 9);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('TaskService.create: creation on screen', () => {
  it('publie task.created', async () => {
    vi.mocked(prisma.task.create).mockResolvedValue({
      id: 1,
      name: 'comp',
      shotId: 7,
      assetId: null,
    } as never);
    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce(taskRow as never);

    await create(supervisor, 3, { name: 'comp', type: TaskType.COMPOSITING, shotId: 7 });

    expect(eventsSent()).toEqual(['task.created']);
  });
});
