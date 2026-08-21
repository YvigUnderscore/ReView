// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role, TaskType } from '@prisma/client';

// Le chemin DCC n'écrivait que la chaîne `Task.department` : la relation restait vide, et
// l'assignation par département — qui interroge la relation — ignorait ces tâches-là.
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

describe('ensureTask — département déclaré', () => {
  it('écrit la clé ET la relation', async () => {
    vi.mocked(resolveForTask).mockResolvedValue({ department: 'LOOKDEV', departmentId: 5 });
    await ensureTask(admin, 7, shot, { name: 'main', department: 'lookdev' });
    expect(resolveForTask).toHaveBeenCalledWith(7, 'lookdev');
    expect(dataOfCreate()).toMatchObject({ department: 'LOOKDEV', departmentId: 5 });
  });

  it('retrouve la tâche d’avant le rattrapage, qui ne porte que la clé', async () => {
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

  it('rattache au passage la tâche que la publication d’avant n’avait pas reliée', async () => {
    vi.mocked(resolveForTask).mockResolvedValue({ department: 'LOOKDEV', departmentId: 5 });
    vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: 12 } as never);
    await ensureTask(admin, 7, shot, { name: 'main', department: 'lookdev' });
    // Le filtre `departmentId: null` rend l'écriture sans effet sur une tâche déjà reliée :
    // aucune ligne ne correspond, `updatedAt` ne bouge pas.
    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: { id: 12, departmentId: null },
      data: { departmentId: 5 },
    });
  });
});

describe('ensureTask — département deviné', () => {
  it('se rattache à l’étape existante sans jamais la créer', async () => {
    // Une heuristique sur le nom de la tâche n'a pas à enrichir le pipe d'un studio.
    vi.mocked(findByKey).mockResolvedValue({ id: 8, key: 'ANIMATION' } as never);
    await ensureTask(admin, 7, shot, { name: 'anim_main' });
    expect(findByKey).toHaveBeenCalledWith(7, TaskType.ANIMATION);
    expect(resolveForTask).not.toHaveBeenCalled();
    expect(dataOfCreate()).toMatchObject({ department: 'ANIMATION', departmentId: 8 });
  });

  it('retombe sur les réglages quand les départements ne sont pas encore des entités', async () => {
    vi.mocked(findByKey).mockResolvedValue(null);
    vi.mocked(resolveProjectSettingsById).mockResolvedValue({
      departments: [{ key: 'ANIMATION', name: 'Animation' }],
    } as never);
    await ensureTask(admin, 7, shot, { name: 'anim_main' });
    expect(dataOfCreate()).toMatchObject({ department: 'ANIMATION', departmentId: null });
  });

  it('n’invente rien quand le nom de la tâche ne dit rien', async () => {
    await ensureTask(admin, 7, shot, { name: 'main' });
    expect(findByKey).not.toHaveBeenCalled();
    expect(resolveForTask).not.toHaveBeenCalled();
    expect(dataOfCreate()).toMatchObject({ department: null, departmentId: null });
  });
});
