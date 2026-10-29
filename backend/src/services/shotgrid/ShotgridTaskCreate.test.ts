// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { task, links } = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), findMany: vi.fn() },
  links: { findByLocal: vi.fn(), upsertLink: vi.fn() },
}));

vi.mock('../../lib/prisma', () => ({ prisma: { task } }));
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./shotgridLinks', () => ({
  findByLocal: (...args: unknown[]) => links.findByLocal(...args),
  upsertLink: (...args: unknown[]) => links.upsertLink(...args),
}));

import { pushTaskCreation } from './ShotgridTaskCreate';

/** The writer and the client, reduced to what that write asks of them. */
function context() {
  const create = vi.fn(async () => ({ id: 909, type: 'Task' }));
  const findById = vi.fn(async () => null as Record<string, unknown> | null);
  return {
    ctx: {
      connectionId: 1,
      client: { findById } as never,
      writer: { create } as never,
      asUserLogin: null,
    },
    create,
    findById,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  task.findUnique.mockResolvedValue({
    id: 50,
    name: 'Flicker sur le halo',
    shotId: 7,
    assetId: null,
    assigneeId: null,
    department: null,
  });
  task.findMany.mockResolvedValue([]);
  links.findByLocal.mockResolvedValue(null);
});

describe('pushTaskCreation (Phase 50)', () => {
  it('creates the Task on the site, attaches it to the remote parent and sets the link', async () => {
    const { ctx, create } = context();
    links.findByLocal.mockImplementation(async (_c: number, type: string) =>
      type === 'shot' ? { sgType: 'Shot', sgId: 300 } : null,
    );
    await pushTaskCreation(ctx, 50);
    expect(create).toHaveBeenCalledWith(
      'Task',
      expect.objectContaining({ content: 'Flicker sur le halo', entity: { type: 'Shot', id: 300 } }),
      { asUserLogin: null },
    );
    expect(links.upsertLink).toHaveBeenCalledWith(
      expect.objectContaining({ localType: 'task', localId: 50, sgType: 'Task', sgId: 909 }),
    );
  });

    /** The job may be replayed: an already linked task must not produce a duplicate. */
  it('does nothing if the task is already linked', async () => {
    const { ctx, create } = context();
    links.findByLocal.mockImplementation(async (_c: number, type: string) =>
      type === 'task' ? { sgType: 'Task', sgId: 909 } : { sgType: 'Shot', sgId: 300 },
    );
    await pushTaskCreation(ctx, 50);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates nothing when the carrying shot does not exist on the site', async () => {
    const { ctx, create } = context();
    await pushTaskCreation(ctx, 50);
    expect(create).not.toHaveBeenCalled();
    expect(links.upsertLink).not.toHaveBeenCalled();
  });

    /**
     * The `Step` catalogue of a site accumulates homonyms: the step is read from a neighbouring
     * task already linked, never guessed from its name.
     */
  it('takes over the step of a neighbouring task in the same department', async () => {
    const { ctx, create, findById } = context();
    task.findUnique.mockResolvedValue({
      id: 50,
      name: 'Retake halo',
      shotId: 7,
      assetId: null,
      assigneeId: 4,
      department: 'comp',
    });
    task.findMany.mockResolvedValue([{ id: 41 }]);
    links.findByLocal.mockImplementation(async (_c: number, type: string, id: number) => {
      if (type === 'shot') return { sgType: 'Shot', sgId: 300 };
      if (type === 'task' && id === 41) return { sgType: 'Task', sgId: 800 };
      if (type === 'user') return { sgType: 'HumanUser', sgId: 55 };
      return null;
    });
    findById.mockResolvedValue({ step: { type: 'Step', id: 14, name: 'comp' } });
    await pushTaskCreation(ctx, 50);
    expect(create).toHaveBeenCalledWith(
      'Task',
      expect.objectContaining({
        step: { type: 'Step', id: 14 },
        task_assignees: [{ type: 'HumanUser', id: 55 }],
      }),
      { asUserLogin: null },
    );
    expect(links.upsertLink).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stepName: 'comp' }) }),
    );
  });

  it('goes out without a step rather than with the wrong one when no neighbour is linked', async () => {
    const { ctx, create } = context();
    task.findUnique.mockResolvedValue({
      id: 50,
      name: 'Retake halo',
      shotId: 7,
      assetId: null,
      assigneeId: null,
      department: 'comp',
    });
    task.findMany.mockResolvedValue([{ id: 41 }]);
    links.findByLocal.mockImplementation(async (_c: number, type: string) =>
      type === 'shot' ? { sgType: 'Shot', sgId: 300 } : null,
    );
    await pushTaskCreation(ctx, 50);
    expect(create).toHaveBeenCalledWith('Task', expect.not.objectContaining({ step: expect.anything() }), {
      asUserLogin: null,
    });
  });
});
