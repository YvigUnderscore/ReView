// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role, TaskType } from '@prisma/client';

// The DCC path only wrote the `Task.department` string: the relation remained empty, and assignment by
// department — which queries the relation — ignored these tasks.
vi.mock('../lib/prisma', () => ({
  prisma: {
    task: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectRoles', () => ({ assertProjectManage: vi.fn(), assertCanContribute: vi.fn() }));
vi.mock('./DepartmentService', () => ({ resolveForTask: vi.fn(), findByKey: vi.fn() }));
vi.mock('../lib/projectSettings', () => ({ resolveProjectSettingsById: vi.fn() }));

import { ensureTask } from './PipelineEnsureService';
import { prisma } from '../lib/prisma';
import { findByKey, resolveForTask } from './DepartmentService';
import { resolveProjectSettingsById } from '../lib/projectSettings';

const admin = { id: 1, role: Role.ADMIN };
const shot = { shotId: 3 };

const dataOfCreate = () => vi.mocked(prisma.task.create).mock.calls[0]![0].data as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.task.create).mockResolvedValue({ id: 42 } as never);
  vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 0 });
});

describe('ensureTask: declared department', () => {
  it('writes the key AND the relation', async () => {
    vi.mocked(resolveForTask).mockResolvedValue({ department: 'LOOKDEV', departmentId: 5 });
    await ensureTask(admin, 7, shot, { name: 'main', department: 'lookdev' });
    expect(resolveForTask).toHaveBeenCalledWith(7, 'lookdev');
    expect(dataOfCreate()).toMatchObject({ department: 'LOOKDEV', departmentId: 5 });
  });

  it('finds the task from before the catch-up, which only carries the key', async () => {
    vi.mocked(resolveForTask).mockResolvedValue({ department: 'LOOKDEV', departmentId: 5 });
    vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: 12 } as never);
    const out = await ensureTask(admin, 7, shot, { name: 'main', department: 'lookdev' });
    expect(out).toEqual({ entity: { id: 12 }, created: false });
    const args = vi.mocked(prisma.task.findFirst).mock.calls[0]![0] ?? {};
    const where = (args.where ?? {}) as Record<string, unknown>;
    expect(where.OR).toEqual([
      { departmentId: 5 },
      { department: { equals: 'LOOKDEV', mode: 'insensitive' } },
    ]);
  });

  it('attaches in passing the task that the earlier publication had not linked', async () => {
    vi.mocked(resolveForTask).mockResolvedValue({ department: 'LOOKDEV', departmentId: 5 });
    vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: 12 } as never);
    await ensureTask(admin, 7, shot, { name: 'main', department: 'lookdev' });
    // The filter `departmentId: null` makes the write have no effect on a task already linked: no row
    // matches, `updatedAt` does not move.
    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: { id: 12, departmentId: null },
      data: { departmentId: 5 },
    });
  });
});

describe('ensureTask: guessed department', () => {
  it('attaches to the existing step without ever creating it', async () => {
    // A heuristic on the task name has no business enriching a studio's pipe.
    vi.mocked(findByKey).mockResolvedValue({ id: 8, key: 'ANIMATION' } as never);
    await ensureTask(admin, 7, shot, { name: 'anim_main' });
    expect(findByKey).toHaveBeenCalledWith(7, TaskType.ANIMATION);
    expect(resolveForTask).not.toHaveBeenCalled();
    expect(dataOfCreate()).toMatchObject({ department: 'ANIMATION', departmentId: 8 });
  });

  it('falls back on the settings when the departments are not yet entities', async () => {
    vi.mocked(findByKey).mockResolvedValue(null);
    vi.mocked(resolveProjectSettingsById).mockResolvedValue({
      departments: [{ key: 'ANIMATION', name: 'Animation' }],
    } as never);
    await ensureTask(admin, 7, shot, { name: 'anim_main' });
    expect(dataOfCreate()).toMatchObject({ department: 'ANIMATION', departmentId: null });
  });

  it('invents nothing when the task name says nothing', async () => {
    await ensureTask(admin, 7, shot, { name: 'main' });
    expect(findByKey).not.toHaveBeenCalled();
    expect(resolveForTask).not.toHaveBeenCalled();
    expect(dataOfCreate()).toMatchObject({ department: null, departmentId: null });
  });
});
