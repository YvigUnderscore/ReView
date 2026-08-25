// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le flux de changements ne partait que de l'API v1 : un statut posé au clic droit, une
 * assignation par lot ou une tâche créée à l'écran ne produisaient ni ligne de journal ni
 * webhook. Ces tests figent l'inverse — l'origine du changement n'a plus d'importance — et
 * la distinction qui compte pour un consommateur : un changement de statut est un
 * événement à lui, pas une « mise à jour » à comparer soi-même.
 */
vi.mock('../lib/prisma', () => ({
  prisma: {
    task: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    comment: { findUnique: vi.fn() },
    // Politique de département (réglage studio) : absente = « open », la règle historique.
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

import { create, setAssignee, update } from './TaskService';
import { prisma } from '../lib/prisma';
import { publish } from './ApiEventService';
import { Role, TaskStatus, TaskType } from '@prisma/client';

const supervisor = { id: 2, role: Role.SUPERVISOR };

/** Ligne au format `taskSelect` : `toTask` a besoin du parent pour composer le chemin. */
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

describe('TaskService.update — flux de changements', () => {
  it('distingue le changement de statut de la mise à jour', async () => {
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

  it('n’annonce pas un changement de statut quand rien n’a bougé', async () => {
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

  it('annonce l’assignation quand elle change réellement', async () => {
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

  it('porte la représentation d’API dans la charge — la même que pour un appel v1', async () => {
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

describe('TaskService.setAssignee — assignation (y compris par lot)', () => {
  beforeEach(() => {
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: 1,
      name: 'comp',
      shotId: 7,
      assetId: null,
    } as never);
  });

  it('publie l’assignation et la mise à jour', async () => {
    vi.mocked(prisma.task.findUnique)
      .mockResolvedValueOnce({ assigneeId: null } as never)
      .mockResolvedValueOnce(taskRow as never);

    await setAssignee(supervisor, 3, 1, 9);

    expect(eventsSent()).toEqual(['task.assigned', 'task.updated']);
  });

  it('reste muet quand l’assigné ne change pas', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce({ assigneeId: 9 } as never);
    await setAssignee(supervisor, 3, 1, 9);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('TaskService.create — création à l’écran', () => {
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
