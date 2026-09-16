// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A1-05 — les trois chemins d'assignation refusent les mêmes personnes.
 *
 * `EntityAssigneeService.assertAssignable` refuse un compte de service, un compte
 * désactivé et quelqu'un qui ne contribue pas au projet ; l'assignation d'entité et
 * l'assignation de review l'appellent. Les tâches, elles, écrivaient `assigneeId` tel
 * quel — à la création, par `setAssignee` (chemin du lot et du clic droit), par `update`
 * et par l'API v1. Ces tests figent le passage des quatre par la garde commune : sans
 * elle, ils écrivent en base et notifient une personne étrangère au projet.
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

/** Ce que rend la garde commune pour quelqu'un qui n'est pas du projet. */
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

describe('TaskService — assignation soumise à la garde commune (A1-05)', () => {
  it('create : refuse et n’écrit rien', async () => {
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

  it('setAssignee : refuse et n’écrit rien (chemin du lot et du clic droit)', async () => {
    refuse();
    await expect(setAssignee(supervisor, PROJECT, 1, OUTSIDER)).rejects.toThrow(/cannot be assigned/);
    expect(assertAssignable).toHaveBeenCalledWith(PROJECT, [OUTSIDER]);
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('update : refuse et n’écrit rien', async () => {
    refuse();
    await expect(update(supervisor, PROJECT, 1, { assigneeId: OUTSIDER })).rejects.toThrow(
      /cannot be assigned/,
    );
    expect(assertAssignable).toHaveBeenCalledWith(PROJECT, [OUTSIDER]);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('applyApiPatch (v1) : refuse et n’écrit rien', async () => {
    refuse();
    await expect(applyApiPatch(supervisor.id, PROJECT, 1, { assigneeId: OUTSIDER })).rejects.toThrow(
      /cannot be assigned/,
    );
    expect(assertAssignable).toHaveBeenCalledWith(PROJECT, [OUTSIDER]);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('désassigner ne consulte pas la garde — `null` n’est personne', async () => {
    await setAssignee(supervisor, PROJECT, 1, null);
    expect(assertAssignable).not.toHaveBeenCalled();
    expect(prisma.task.update).toHaveBeenCalled();
  });

  it('un assigné acceptable passe, sur les quatre chemins', async () => {
    await create(supervisor, PROJECT, { name: 'comp', type: TaskType.COMPOSITING, shotId: 7, assigneeId: 4 });
    await setAssignee(supervisor, PROJECT, 1, 4);
    await update(supervisor, PROJECT, 1, { assigneeId: 4 });
    await applyApiPatch(supervisor.id, PROJECT, 1, { assigneeId: 4 });
    expect(assertAssignable).toHaveBeenCalledTimes(4);
    expect(assertAssignable).toHaveBeenLastCalledWith(PROJECT, [4]);
  });
});
