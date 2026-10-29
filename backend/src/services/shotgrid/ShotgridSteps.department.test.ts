// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Creating a task from a site step only wrote the `department` string: the task was born without a relation, hence invisible to assignment by department.
vi.mock('../../lib/prisma', () => ({
  prisma: { shotgridLink: { findFirst: vi.fn() }, task: { create: vi.fn() } },
}));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('./ShotgridConfigService', () => ({ openConnection: vi.fn() }));
vi.mock('./shotgridLinks', () => ({ upsertLink: vi.fn() }));
vi.mock('./shotgridSettings', () => ({ can: () => true }));
vi.mock('./shotgridProjectGuard', () => ({
  belongsToProject: () => ({ ok: true }),
  projectFilter: () => ['project', 'is', 1],
}));
vi.mock('./shotgridTemplateGuard', () => ({ writeAllowedOn: () => true }));
vi.mock('../DepartmentService', () => ({ resolveForTask: vi.fn() }));

import { createTaskFromStep } from './ShotgridSteps';
import { prisma } from '../../lib/prisma';
import { openConnection } from './ShotgridConfigService';
import { upsertLink } from './shotgridLinks';
import { resolveForTask } from '../DepartmentService';

const ctx = {
  connection: { id: 3, projectId: 7, sgProjectId: 1, sgProjectName: 'FILM' },
  settings: {},
  client: {
    findById: vi.fn(),
    search: vi.fn(),
  },
    // Creation goes through the writer: it is the one that sets the linked project and re-reads what the site wrote. Its own suite tests it; here we only double the write.
  writer: { create: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(openConnection).mockResolvedValue(ctx as never);
  ctx.client.findById.mockImplementation((type: string, id: number) =>
    type === 'Step' ? { id, code: 'Look Development' } : { id, project: { id: 1 } },
  );
  ctx.writer.create.mockResolvedValue({ id: 900 });
  vi.mocked(prisma.shotgridLink.findFirst).mockResolvedValue({ sgId: 100, sgType: 'Asset' } as never);
  vi.mocked(prisma.task.create).mockResolvedValue({ id: 42 } as never);
  vi.mocked(resolveForTask).mockResolvedValue({ department: 'LOOK_DEVELOPMENT', departmentId: 5 });
});

describe('createTaskFromStep', () => {
  it('attaches the task to the project department, relation included', async () => {
    const out = await createTaskFromStep(
      7,
      { stepSgId: 14, parentType: 'asset', parentId: 12 },
      'sup@studio.tv',
    );
    expect(out).toEqual({ taskId: 42, sgId: 900, name: 'Look Development' });
    expect(resolveForTask).toHaveBeenCalledWith(7, 'Look Development');
    const data = vi.mocked(prisma.task.create).mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ department: 'LOOK_DEVELOPMENT', departmentId: 5, assetId: 12 });
  });

  it('keeps in the link the step name as the site writes it', async () => {
        // The link describes the remote side: the normalized key would no longer designate anything there.
    await createTaskFromStep(7, { stepSgId: 14, parentType: 'shot', parentId: 4 }, null);
    const call = vi.mocked(upsertLink).mock.calls[0]![0];
    expect(call.data).toMatchObject({ stepName: 'Look Development' });
    expect(call.localId).toBe(42);
  });
});
