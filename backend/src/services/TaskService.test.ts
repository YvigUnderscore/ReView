// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    task: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    comment: { findUnique: vi.fn() },
        // Deletion guard (Phase 50): `Version.taskId` cascades, so a task carrying versions cannot be deleted.
        // Empty by default.
    version: { count: vi.fn().mockResolvedValue(0) },
        // Archive lock (38.B): project open by default.
    project: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
        // Rights are read from the EFFECTIVE role (38.E): by default, a member without a local role
        // (hence judged on their global role), which the cases below already tested.
    projectMembership: { findUnique: vi.fn().mockResolvedValue({ role: null }) },
        // Department policy (studio setting): absent = "open", the historical rule.
    setting: { findUnique: vi.fn().mockResolvedValue(null) },
    user: { findUnique: vi.fn().mockResolvedValue({ departments: [] }) },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn() }));
vi.mock('./DepartmentService', () => ({ resolveByKey: vi.fn().mockResolvedValue(null) }));
vi.mock('./PipelineStatusService', () => ({
  listForProject: vi.fn().mockResolvedValue([]),
  resolveByLegacy: vi.fn().mockResolvedValue(null),
}));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));

import { createFromComment, taskNameFromComment, update, remove } from './TaskService';
import { prisma } from '../lib/prisma';
import { notify } from './NotificationService';
import * as DepartmentService from './DepartmentService';
import * as PipelineStatusService from './PipelineStatusService';
import { enqueuePush } from './shotgrid/ShotgridPushService';
import { Prisma, Role, TaskStatus } from '@prisma/client';

const supervisor = { id: 2, role: Role.SUPERVISOR };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.task.create).mockResolvedValue({
    id: 50,
    name: 'n',
    shotId: 7,
    assetId: null,
  } as never);
});

describe('taskNameFromComment (32.D)', () => {
  it('strips the HTML, collapses the spaces and truncates to 80', () => {
    expect(taskNameFromComment('<b>corriger</b>\n  le  reflet')).toBe('corriger le reflet');
    const long = 'x'.repeat(120);
    expect(taskNameFromComment(long)).toHaveLength(80);
    expect(taskNameFromComment(long).endsWith('…')).toBe(true);
  });
  /**
   * The fallback is written in ENGLISH: the database is in English, and a name stored in French would
   * have shown as is in all fourteen interface languages.
   */
  it('English fallback for a comment without text', () => {
    expect(taskNameFromComment('<img src="x">')).toBe('Review feedback');
  });
});

describe('createFromComment (32.D)', () => {
  it('attaches the task to the version\'s shot and takes over the assignee', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      id: 9,
      content: 'corriger le reflet',
      assigneeId: 4,
      media: { version: { assetId: null, task: { shotId: 7, assetId: null } } },
    } as never);
    await createFromComment(supervisor, 3, 9);
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'corriger le reflet',
          shotId: 7,
          assetId: null,
          assigneeId: 4,
          sourceCommentId: 9,
        }),
      }),
    );
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 4, kind: 'taskAssigned' }));
  });

  it('direct asset version: task attached to the asset', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      id: 9,
      content: 'ok',
      assigneeId: null,
      media: { version: { assetId: 12, task: null } },
    } as never);
    await createFromComment(supervisor, 3, 9);
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ shotId: null, assetId: 12 }) }),
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('400 if the media has neither shot nor asset, 404 if the comment is unknown', async () => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue({
      id: 9,
      content: 'x',
      assigneeId: null,
      media: { version: { assetId: null, task: null } },
    } as never);
    await expect(createFromComment(supervisor, 3, 9)).rejects.toMatchObject({ statusCode: 400 });
    vi.mocked(prisma.comment.findUnique).mockResolvedValue(null);
    await expect(createFromComment(supervisor, 3, 99)).rejects.toMatchObject({ statusCode: 404 });
  });
});

/**
 * This path checked NOTHING: neither the rights (the route read them from the global role), nor the archive
 * state, and the task was born without a step or a reference status, hence in the kanban's fallback column
 * (Phase 50, batch 5).
 */
describe('createFromComment: guards and completeness (Phase 50)', () => {
  const artist = { id: 4, role: Role.ARTIST };
  const onComp = {
    id: 9,
    content: 'corriger le reflet',
    assigneeId: null,
    media: {
      version: { assetId: null, task: { shotId: 7, assetId: null, type: 'COMP', department: 'comp' } },
    },
  };

  beforeEach(() => {
    vi.mocked(prisma.comment.findUnique).mockResolvedValue(onComp as never);
    vi.mocked(prisma.projectMembership.findUnique).mockResolvedValue({ role: null } as never);
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ status: 'ACTIVE' } as never);
    vi.mocked(DepartmentService.resolveByKey).mockResolvedValue(null);
    vi.mocked(PipelineStatusService.resolveByLegacy).mockResolvedValue(null);
  });

  it('an ARTIST is refused (403), the supervisor OF THE PROJECT is accepted', async () => {
    await expect(createFromComment(artist, 3, 9)).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.task.create).not.toHaveBeenCalled();
    vi.mocked(prisma.projectMembership.findUnique).mockResolvedValue({ role: Role.SUPERVISOR } as never);
    await createFromComment(artist, 3, 9);
    expect(prisma.task.create).toHaveBeenCalled();
  });

  it('refuses an archived project (38.B)', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ status: 'ARCHIVED' } as never);
    await expect(createFromComment(supervisor, 3, 9)).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('inherits the step and entry status from the project\'s reference list', async () => {
    vi.mocked(DepartmentService.resolveByKey).mockResolvedValue({ id: 6, key: 'comp' } as never);
    vi.mocked(PipelineStatusService.resolveByLegacy).mockResolvedValue({
      id: 31,
      legacyStatus: TaskStatus.TODO,
    } as never);
    await createFromComment(supervisor, 3, 9);
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          department: 'comp',
          departmentId: 6,
          pipelineStatusId: 31,
          status: TaskStatus.TODO,
          type: 'COMP',
        }),
      }),
    );
  });

  it('takes the name from the dialog, and the instruction with it', async () => {
    await createFromComment(supervisor, 3, 9, { name: '  Flicker sur le halo  ', description: ' à revoir ' });
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Flicker sur le halo', description: 'à revoir' }),
      }),
    );
  });

  it('an empty name falls back to the comment text', async () => {
    await createFromComment(supervisor, 3, 9, { name: '   ' });
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'corriger le reflet' }) }),
    );
  });

  it('named 409 when the step already carries this name, rather than an internal error', async () => {
    const unique = Object.assign(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5',
      }),
    );
    vi.mocked(prisma.task.create).mockRejectedValueOnce(unique);
    await expect(createFromComment(supervisor, 3, 9)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TASK_NAME_TAKEN',
    });
  });

  it('requests the creation of the task on the ShotGrid site', async () => {
    await createFromComment(supervisor, 3, 9);
    expect(enqueuePush).toHaveBeenCalledWith(3, expect.objectContaining({ type: 'task-create', taskId: 50 }));
  });
});

/**
 * `Version.taskId` is `onDelete: Cascade`: without a guard, exposing "Delete" on the kanban's right-click
 * would destroy published versions and media (Phase 50, batch 5).
 */
describe('remove: version guard (Phase 50)', () => {
  beforeEach(() => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ shotId: 7, assetId: null } as never);
  });

  it('refuses (409) a task carrying versions, and says how many', async () => {
    vi.mocked(prisma.version.count).mockResolvedValue(3);
    await expect(remove(supervisor, 3, 1)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TASK_HAS_VERSIONS',
      details: { count: 3 },
    });
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });

  it('deletes an empty task', async () => {
    vi.mocked(prisma.version.count).mockResolvedValue(0);
    await remove(supervisor, 3, 1);
    expect(prisma.task.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});

describe('update: checklist & rights (38.F)', () => {
  const artist = { id: 4, role: Role.ARTIST };
  beforeEach(() => {
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: 1,
      name: 'n',
      shotId: 7,
      assetId: null,
    } as never);
  });

  it('the assignee can tick the checklist of their task', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ assigneeId: 4 } as never);
    await update(artist, 3, 1, { checklist: [{ text: 'a', done: true }] });
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ checklist: [{ text: 'a', done: true }] }) }),
    );
  });

  it('a non-assignee non-manager cannot edit the checklist (403)', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ assigneeId: 99 } as never);
    await expect(update(artist, 3, 1, { checklist: [] })).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.task.update).not.toHaveBeenCalled();
  });
});

/**
 * The authorization model is that of the EFFECTIVE role on the project (38.E). The competing model, a
 * `isGlobalManager(user.role)` copied into the service, refused a supervisor named on THIS project from
 * renaming or deleting a task there.
 */
describe('effective project role (38.E)', () => {
  const artist = { id: 4, role: Role.ARTIST };
  const membership = vi.mocked(prisma.projectMembership.findUnique);

  beforeEach(() => {
    membership.mockResolvedValue({ role: null } as never);
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: 1,
      name: 'n',
      shotId: 7,
      assetId: null,
    } as never);
  });

  it('an ARTIST promoted to SUPERVISOR on the project renames a task not assigned to them', async () => {
    membership.mockResolvedValue({ role: Role.SUPERVISOR } as never);
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ assigneeId: 99 } as never);
    await update(artist, 3, 1, { name: 'Nouveau nom' });
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Nouveau nom' }) }),
    );
  });

  it('an ARTIST promoted to SUPERVISOR on the project deletes a task', async () => {
    membership.mockResolvedValue({ role: Role.SUPERVISOR } as never);
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ shotId: 7, assetId: null } as never);
    await remove(artist, 3, 1);
    expect(prisma.task.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('an ARTIST without local elevation does not delete (403)', async () => {
    await expect(remove(artist, 3, 1)).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });
});
