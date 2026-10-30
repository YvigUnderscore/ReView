// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';

const { db, tasks, departments } = vi.hoisted(() => ({
  db: {
    asset: { findFirst: vi.fn() },
    shot: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    task: { findMany: vi.fn(), create: vi.fn() },
    shotgridConnection: { findUnique: vi.fn() },
  },
  tasks: { setAssignee: vi.fn() },
  departments: {
    assertDepartmentsOfProject: vi.fn(),
    attachHolderDepartments: vi.fn(),
    listForProject: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectRoles', async () => {
  const actual = await vi.importActual<typeof import('../lib/projectRoles')>('../lib/projectRoles');
  return { ...actual, assertProjectManage: vi.fn(), effectiveProjectRole: vi.fn() };
});
vi.mock('./TaskService', () => tasks);
vi.mock('./DepartmentService', () => departments);
// `assertAssignable` now lives in `EntityAssigneeService` and is exercised here for real: it is its two
// boundary dependencies that are stubbed, not the guard itself.
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/userView', () => ({ avatarUrl: vi.fn(async () => null) }));

import { effectiveProjectRole } from '../lib/projectRoles';
import { assignEntity, assignMany } from './AssignmentService';

const actor = { id: 1, role: Role.ADMIN };

beforeEach(() => {
  vi.clearAllMocks();
  db.asset.findFirst.mockResolvedValue({ projectId: 42 });
  db.shot.findFirst.mockResolvedValue({ projectId: 42 });
  db.user.findMany.mockResolvedValue([{ id: 9, role: Role.ARTIST, isService: false, disabledAt: null }]);
  db.shotgridConnection.findUnique.mockResolvedValue(null);
  vi.mocked(effectiveProjectRole).mockResolvedValue(Role.ARTIST);
  departments.listForProject.mockResolvedValue([{ id: 3, key: 'COMP', name: 'Compositing' }]);
});

describe('assignEntity', () => {
  it("sets the person on the asset's existing tasks", async () => {
    db.task.findMany.mockResolvedValue([
      { id: 11, assigneeId: null, departmentId: 3 },
      { id: 12, assigneeId: null, departmentId: 4 },
    ]);
    const result = await assignEntity(actor, { holder: 'asset', id: 5, userId: 9 });
    expect(result).toEqual({ updated: 2, created: 0 });
    expect(tasks.setAssignee).toHaveBeenCalledWith(actor, 42, 11, 9);
  });

  it('does not write to a task already assigned to this person', async () => {
    // Without this early exit, every assignment would re-notify the artist and push to ShotGrid for nothing.
    db.task.findMany.mockResolvedValue([{ id: 11, assigneeId: 9, departmentId: 3 }]);
    const result = await assignEntity(actor, { holder: 'asset', id: 5, userId: 9 });
    expect(result.updated).toBe(0);
    expect(tasks.setAssignee).not.toHaveBeenCalled();
  });

  it('creates the missing task for the targeted department', async () => {
    db.task.findMany.mockResolvedValue([]);
    db.task.create.mockResolvedValue({ id: 20 });
    const result = await assignEntity(actor, {
      holder: 'asset',
      id: 5,
      userId: 9,
      departmentIds: [3],
    });
    expect(result).toEqual({ updated: 1, created: 1 });
    expect(db.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assetId: 5, departmentId: 3 }) }),
    );
    // The department becomes a step the asset goes through: no need to declare it again.
    expect(departments.attachHolderDepartments).toHaveBeenCalledWith('asset', 5, [3]);
  });

  it('refuses to create a task on a project driven from ShotGrid', async () => {
    // The task must be born on the site: creating one here would make two at the next sync.
    db.task.findMany.mockResolvedValue([]);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: true });
    await expect(
      assignEntity(actor, { holder: 'asset', id: 5, userId: 9, departmentIds: [3] }),
    ).rejects.toMatchObject({ code: 'TASK_MISSING' });
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it('refuses a service account', async () => {
    db.task.findMany.mockResolvedValue([{ id: 11, assigneeId: null, departmentId: 3 }]);
    db.user.findMany.mockResolvedValue([{ id: 9, role: Role.ARTIST, isService: true, disabledAt: null }]);
    await expect(assignEntity(actor, { holder: 'asset', id: 5, userId: 9 })).rejects.toMatchObject({
      code: 'NOT_ASSIGNABLE',
    });
  });

  /**
   * The private copy of `assertAssignable` kept by this service had diverged from the shared guard: it did
   * not read `disabledAt`. A disabled account was therefore refused as the owner of a shot
   * (`EntityAssigneeService`) yet accepted as the assignee of a task, one of the two paths serving as a
   * service door to the other. There is now only one guard.
   */
  it('refuses a disabled account, as entity assignment does', async () => {
    db.task.findMany.mockResolvedValue([{ id: 11, assigneeId: null, departmentId: 3 }]);
    db.user.findMany.mockResolvedValue([
      { id: 9, role: Role.ARTIST, isService: false, disabledAt: new Date('2026-01-01') },
    ]);
    await expect(assignEntity(actor, { holder: 'asset', id: 5, userId: 9 })).rejects.toMatchObject({
      code: 'NOT_ASSIGNABLE',
    });
    expect(tasks.setAssignee).not.toHaveBeenCalled();
  });

  it('refuses an unknown person', async () => {
    db.task.findMany.mockResolvedValue([{ id: 11, assigneeId: null, departmentId: 3 }]);
    db.user.findMany.mockResolvedValue([]);
    await expect(assignEntity(actor, { holder: 'asset', id: 5, userId: 9 })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('refuses a client and a non-member', async () => {
    db.task.findMany.mockResolvedValue([{ id: 11, assigneeId: null, departmentId: 3 }]);
    vi.mocked(effectiveProjectRole).mockResolvedValue(Role.CLIENT);
    await expect(assignEntity(actor, { holder: 'asset', id: 5, userId: 9 })).rejects.toMatchObject({
      code: 'NOT_ASSIGNABLE',
    });
    vi.mocked(effectiveProjectRole).mockResolvedValue(null);
    await expect(assignEntity(actor, { holder: 'asset', id: 5, userId: 9 })).rejects.toMatchObject({
      code: 'NOT_ASSIGNABLE',
    });
  });

  it('unassigns without checking the person', async () => {
    db.task.findMany.mockResolvedValue([{ id: 11, assigneeId: 9, departmentId: 3 }]);
    const result = await assignEntity(actor, { holder: 'asset', id: 5, userId: null });
    expect(result.updated).toBe(1);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('reports an entity with no task at all', async () => {
    db.task.findMany.mockResolvedValue([]);
    await expect(assignEntity(actor, { holder: 'asset', id: 5, userId: 9 })).rejects.toMatchObject({
      code: 'NO_TASK',
    });
  });
});

describe('assignMany', () => {
  it('counts separately what could not be assigned, without losing the rest', async () => {
    db.task.findMany
      .mockResolvedValueOnce([{ id: 11, assigneeId: null, departmentId: 3 }])
      .mockResolvedValueOnce([]) // this one has no task
      .mockResolvedValueOnce([{ id: 13, assigneeId: null, departmentId: 3 }]);
    const result = await assignMany(actor, 'asset', [1, 2, 3], { userId: 9 });
    expect(result).toEqual({ updated: 2, created: 0, skipped: 1 });
  });
});
