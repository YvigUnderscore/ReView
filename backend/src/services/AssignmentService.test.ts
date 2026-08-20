// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';

const { db, tasks, departments } = vi.hoisted(() => ({
  db: {
    asset: { findFirst: vi.fn() },
    shot: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
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

import { effectiveProjectRole } from '../lib/projectRoles';
import { assignEntity, assignMany } from './AssignmentService';

const actor = { id: 1, role: Role.ADMIN };

beforeEach(() => {
  vi.clearAllMocks();
  db.asset.findFirst.mockResolvedValue({ projectId: 42 });
  db.shot.findFirst.mockResolvedValue({ projectId: 42 });
  db.user.findUnique.mockResolvedValue({ id: 9, role: Role.ARTIST, isService: false });
  db.shotgridConnection.findUnique.mockResolvedValue(null);
  vi.mocked(effectiveProjectRole).mockResolvedValue(Role.ARTIST);
  departments.listForProject.mockResolvedValue([{ id: 3, key: 'COMP', name: 'Compositing' }]);
});

describe('assignEntity', () => {
  it('pose la personne sur les tâches existantes de l’asset', async () => {
    db.task.findMany.mockResolvedValue([
      { id: 11, assigneeId: null, departmentId: 3 },
      { id: 12, assigneeId: null, departmentId: 4 },
    ]);
    const result = await assignEntity(actor, { holder: 'asset', id: 5, userId: 9 });
    expect(result).toEqual({ updated: 2, created: 0 });
    expect(tasks.setAssignee).toHaveBeenCalledWith(actor, 42, 11, 9);
  });

  it('n’écrit pas sur une tâche déjà confiée à cette personne', async () => {
    // Sans cette sortie, chaque assignation renotifierait l'artiste et repartirait
    // vers ShotGrid pour rien.
    db.task.findMany.mockResolvedValue([{ id: 11, assigneeId: 9, departmentId: 3 }]);
    const result = await assignEntity(actor, { holder: 'asset', id: 5, userId: 9 });
    expect(result.updated).toBe(0);
    expect(tasks.setAssignee).not.toHaveBeenCalled();
  });

  it('crée la tâche manquante du département visé', async () => {
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
    // Le département devient une étape que l'asset traverse : inutile de le redéclarer.
    expect(departments.attachHolderDepartments).toHaveBeenCalledWith('asset', 5, [3]);
  });

  it('refuse de créer une tâche sur un projet piloté depuis ShotGrid', async () => {
    // La tâche doit naître sur le site : en créer une ici en ferait deux à la
    // synchronisation suivante.
    db.task.findMany.mockResolvedValue([]);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: true });
    await expect(
      assignEntity(actor, { holder: 'asset', id: 5, userId: 9, departmentIds: [3] }),
    ).rejects.toMatchObject({ code: 'TASK_MISSING' });
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it('refuse un compte de service', async () => {
    db.task.findMany.mockResolvedValue([{ id: 11, assigneeId: null, departmentId: 3 }]);
    db.user.findUnique.mockResolvedValue({ id: 9, role: Role.ARTIST, isService: true });
    await expect(assignEntity(actor, { holder: 'asset', id: 5, userId: 9 })).rejects.toMatchObject({
      code: 'NOT_ASSIGNABLE',
    });
  });

  it('refuse un client et un non-membre', async () => {
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

  it('désassigne sans contrôler la personne', async () => {
    db.task.findMany.mockResolvedValue([{ id: 11, assigneeId: 9, departmentId: 3 }]);
    const result = await assignEntity(actor, { holder: 'asset', id: 5, userId: null });
    expect(result.updated).toBe(1);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('signale une entité sans aucune tâche', async () => {
    db.task.findMany.mockResolvedValue([]);
    await expect(assignEntity(actor, { holder: 'asset', id: 5, userId: 9 })).rejects.toMatchObject({
      code: 'NO_TASK',
    });
  });
});

describe('assignMany', () => {
  it('compte à part ce qui n’a pas pu être assigné, sans perdre le reste', async () => {
    db.task.findMany
      .mockResolvedValueOnce([{ id: 11, assigneeId: null, departmentId: 3 }])
      .mockResolvedValueOnce([]) // celui-ci n'a aucune tâche
      .mockResolvedValueOnce([{ id: 13, assigneeId: null, departmentId: 3 }]);
    const result = await assignMany(actor, 'asset', [1, 2, 3], { userId: 9 });
    expect(result).toEqual({ updated: 2, created: 0, skipped: 1 });
  });
});
