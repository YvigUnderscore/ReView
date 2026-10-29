// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/prisma', () => ({
  prisma: {
    department: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    project: { findUnique: vi.fn() },
    asset: { update: vi.fn(), findUnique: vi.fn() },
    shot: { update: vi.fn(), findUnique: vi.fn() },
    sequence: { update: vi.fn(), findUnique: vi.fn() },
    user: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import {
  attachHolderDepartments,
  create,
  detachHolderDepartments,
  findByKey,
  listForProject,
  normaliseKey,
  remove,
  reorder,
  resolveByKey,
  resolveForTask,
  setHolderDepartments,
  setUserDepartments,
  syncFromSettings,
  update,
} from './DepartmentService';
import { prisma } from '../lib/prisma';
import { logAudit } from './AuditService';

/** Actor of the logged gestures — the caller always knows it (`req.user`). */
const ACTOR = { id: 42 };
const audited = vi.mocked(logAudit);

const dept = (over: Record<string, unknown> = {}) => ({
  id: 1,
  studioId: 1,
  projectId: null,
  key: 'ANIMATION',
  name: 'Animation',
  order: 0,
  color: null,
  deletedAt: null,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('normaliseKey', () => {
  it('uppercases and replaces punctuation', () => {
    expect(normaliseKey('Look Dev')).toBe('LOOK_DEV');
    expect(normaliseKey('  fx  ')).toBe('FX');
    expect(normaliseKey('Matte-Painting')).toBe('MATTE_PAINTING');
  });

  it('strips leading and trailing underscores', () => {
    expect(normaliseKey('  --anim--  ')).toBe('ANIM');
  });

  it('returns an empty string for input with no usable character', () => {
    expect(normaliseKey('   ')).toBe('');
    expect(normaliseKey('---')).toBe('');
  });

  it('bounds the length', () => {
    expect(normaliseKey('a'.repeat(80))).toHaveLength(40);
  });
});

describe('listForProject', () => {
  it("returns the project's departments when it has any", async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept({ projectId: 7 })] as never);
    const list = await listForProject(7);
    expect(list).toHaveLength(1);
    // The studio is not even consulted: the project's list replaces its own.
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it('falls back on the studio reference when the project does not redefine it', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 3 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept()] as never);
    const list = await listForProject(7);
    // `imageUrl` now accompanies each department: the list is signed once for all, rather than one request
    // per displayed badge.
    expect(list).toEqual([{ ...dept(), imageUrl: null }]);
    expect(prisma.department.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { studioId: 3, projectId: null, deletedAt: null } }),
    );
  });

  it('returns an empty list for a nonexistent project', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(null);
    expect(await listForProject(999)).toEqual([]);
  });
});

describe('create', () => {
  it('derives the key from the name and places it at the end of the list', async () => {
    vi.mocked(prisma.department.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.department.findFirst).mockResolvedValueOnce({ order: 4 } as never);
    vi.mocked(prisma.department.create).mockResolvedValueOnce(dept() as never);
    await create(1, null, { name: 'Look Dev' });
    expect(prisma.department.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ key: 'LOOK_DEV', name: 'Look Dev', order: 5 }),
      }),
    );
  });

  it('refuses an empty name', async () => {
    await expect(create(1, null, { name: '   ' })).rejects.toThrow();
  });

  it('refuses a key already taken', async () => {
    vi.mocked(prisma.department.findFirst).mockResolvedValueOnce(dept() as never);
    await expect(create(1, null, { name: 'Animation' })).rejects.toThrow();
  });

  it('revives a removed department rather than creating a duplicate', async () => {
    // The key must stay the same, otherwise earlier tasks would not be found again.
    vi.mocked(prisma.department.findFirst).mockResolvedValueOnce(
      dept({ id: 12, deletedAt: new Date() }) as never,
    );
    vi.mocked(prisma.department.update).mockResolvedValueOnce(dept({ id: 12 }) as never);
    await create(1, null, { name: 'Animation' });
    expect(prisma.department.create).not.toHaveBeenCalled();
    expect(prisma.department.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 12 }, data: expect.objectContaining({ deletedAt: null }) }),
    );
  });
});

describe('update', () => {
  it('never touches the key', async () => {
    vi.mocked(prisma.department.findUnique).mockResolvedValueOnce(dept() as never);
    vi.mocked(prisma.department.update).mockResolvedValueOnce(dept() as never);
    await update(ACTOR, 1, { name: 'Anim', key: 'AUTRE_CHOSE' });
    const data = vi.mocked(prisma.department.update).mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('key');
    expect(data.name).toBe('Anim');
  });

  it('refuses a nonexistent department', async () => {
    vi.mocked(prisma.department.findUnique).mockResolvedValueOnce(null);
    await expect(update(ACTOR, 404, { name: 'x' })).rejects.toThrow();
  });
});

describe('remove', () => {
  it('removes logically, without erasing the work attached to it', async () => {
    vi.mocked(prisma.department.findUnique).mockResolvedValueOnce(dept() as never);
    vi.mocked(prisma.department.update).mockResolvedValueOnce(dept() as never);
    await remove(ACTOR, 1);
    const data = vi.mocked(prisma.department.update).mock.calls[0]![0].data as { deletedAt: Date };
    expect(data.deletedAt).toBeInstanceOf(Date);
  });
});

describe('findByKey', () => {
  it('finds regardless of case', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept()] as never);
    expect((await findByKey(7, 'animation'))?.id).toBe(1);
  });

  it('finds despite punctuation: the remote site writes "Look Dev", the database LOOK_DEV', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept({ key: 'LOOK_DEV' })] as never);
    expect((await findByKey(7, 'Look Dev'))?.key).toBe('LOOK_DEV');
  });

  it('prefers the project scope over the studio scope', async () => {
    // Both scopes are searched — `listForProject` would mask the studio as soon as the project has its own
    // list, and a task carrying a studio step would become unfindable.
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([
      dept({ id: 1, projectId: null }),
      dept({ id: 2, projectId: 7 }),
    ] as never);
    expect((await findByKey(7, 'ANIMATION'))?.id).toBe(2);
  });

  it('returns null when no scope carries the key, without creating anything', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept()] as never);
    expect(await findByKey(7, 'Groom')).toBeNull();
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  it('returns null for a nonexistent project or an empty key', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(null);
    expect(await findByKey(999, 'ANIMATION')).toBeNull();
    expect(await findByKey(7, '   ')).toBeNull();
  });
});

describe('resolveByKey', () => {
  it('finds an existing department regardless of case', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept()] as never);
    const found = await resolveByKey(7, 'animation');
    expect(found?.id).toBe(1);
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  it('creates the unknown step rather than losing it — the case of a ShotGrid step', async () => {
    vi.mocked(prisma.project.findUnique)
      .mockResolvedValueOnce({ studioId: 1 } as never)
      .mockResolvedValueOnce({ studioId: 1 } as never);
    // Known vocabulary, then the project's own list (the inheritance is already frozen).
    vi.mocked(prisma.department.findMany)
      .mockResolvedValueOnce([dept({ projectId: 7 })] as never)
      .mockResolvedValueOnce([dept({ projectId: 7 })] as never);
    vi.mocked(prisma.department.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.department.create).mockResolvedValueOnce(dept({ id: 9, key: 'GROOM' }) as never);
    const found = await resolveByKey(7, 'Groom');
    expect(found?.key).toBe('GROOM');
    expect(prisma.department.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ projectId: 7 }) }),
    );
    expect(prisma.department.createMany).not.toHaveBeenCalled();
  });

  it('copies the studio inheritance before adding a step to a project that inherits it', async () => {
    // Without this copy, the imported step would REPLACE the inherited list: the project would lose its eight
    // departments to keep only one.
    vi.mocked(prisma.project.findUnique)
      .mockResolvedValueOnce({ studioId: 1 } as never)
      .mockResolvedValueOnce({ studioId: 1 } as never);
    const studio = [dept({ id: 1, key: 'ANIMATION' }), dept({ id: 2, key: 'FX', name: 'FX' })];
    vi.mocked(prisma.department.findMany)
      .mockResolvedValueOnce(studio as never) // vocabulary searched by findByKey
      .mockResolvedValueOnce([] as never) // the project has no step of its own
      .mockResolvedValueOnce(studio as never); // studio list, to be copied
    vi.mocked(prisma.department.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.department.create).mockResolvedValueOnce(
      dept({ id: 9, key: 'GROOM', projectId: 7 }) as never,
    );
    await resolveByKey(7, 'Groom');
    expect(prisma.department.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ projectId: 7, key: 'ANIMATION' }),
          expect.objectContaining({ projectId: 7, key: 'FX' }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('re-reads the step that a concurrent publication has just created', async () => {
    vi.mocked(prisma.project.findUnique)
      .mockResolvedValueOnce({ studioId: 1 } as never)
      .mockResolvedValueOnce({ studioId: 1 } as never)
      .mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany)
      .mockResolvedValueOnce([] as never) // findByKey: nothing
      .mockResolvedValueOnce([dept({ projectId: 7 })] as never) // project's own list: no copy
      .mockResolvedValueOnce([dept({ id: 9, key: 'GROOM', projectId: 7 })] as never); // re-read
    vi.mocked(prisma.department.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.department.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    expect((await resolveByKey(7, 'Groom'))?.id).toBe(9);
  });

  it('ignores an empty key', async () => {
    expect(await resolveByKey(7, '   ')).toBeNull();
    expect(prisma.department.findMany).not.toHaveBeenCalled();
  });
});

describe('resolveForTask', () => {
  it('returns the key AND the relation: it is the relation that assignment reads', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept({ id: 4 })] as never);
    expect(await resolveForTask(7, 'animation')).toEqual({ department: 'ANIMATION', departmentId: 4 });
  });

  it('keeps the key without creating anything when creation is refused', async () => {
    // Policy applied to guessed keys: a heuristic does not enrich the pipe.
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never);
    expect(await resolveForTask(7, 'Groom', { create: false })).toEqual({
      department: 'Groom',
      departmentId: null,
    });
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  it('returns an empty pair for an absent key', async () => {
    expect(await resolveForTask(7, null)).toEqual({ department: null, departmentId: null });
    expect(await resolveForTask(7, '  ')).toEqual({ department: null, departmentId: null });
  });
});

describe('syncFromSettings', () => {
  it('writes nothing when the list is identical to the one inherited from the studio', async () => {
    // Otherwise the project would cease to inherit and would no longer follow the studio's changes.
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept()] as never);
    await syncFromSettings(7, [{ key: 'ANIMATION', name: 'Animation' }]);
    expect(prisma.department.create).not.toHaveBeenCalled();
    expect(prisma.department.update).not.toHaveBeenCalled();
  });

  it('creates the missing steps in list order', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([dept()] as never); // inherited
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never); // own
    vi.mocked(prisma.department.create).mockResolvedValue(dept({ id: 30 }) as never);
    await syncFromSettings(7, [
      { key: 'Layout', name: 'Layout' },
      { key: 'ANIMATION', name: 'Animation' },
    ]);
    expect(prisma.department.create).toHaveBeenCalledTimes(2);
    const first = vi.mocked(prisma.department.create).mock.calls[0]![0].data as Record<string, unknown>;
    expect(first).toMatchObject({ key: 'LAYOUT', order: 0, projectId: 7 });
  });

  it('renames and reorders without touching the key', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([
      dept({ id: 5, projectId: 7, key: 'ANIM', name: 'Anim', order: 3 }),
    ] as never);
    await syncFromSettings(7, [{ key: 'ANIM', name: 'Animation' }]);
    expect(prisma.department.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({ name: 'Animation', order: 0, deletedAt: null }),
      }),
    );
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  it('logically removes what has disappeared from the list', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([
      dept({ id: 5, projectId: 7, key: 'ANIM' }),
      dept({ id: 6, projectId: 7, key: 'FX' }),
    ] as never);
    await syncFromSettings(7, [{ key: 'ANIM', name: 'Anim' }]);
    expect(prisma.department.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [6] } } }),
    );
  });

  it('ignores an entry without a usable key', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ studioId: 1 } as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([] as never);
    await syncFromSettings(7, [{ key: '  ', name: '  ' }]);
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  it('does nothing for a nonexistent project', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(null);
    await syncFromSettings(999, [{ key: 'FX', name: 'FX' }]);
    expect(prisma.department.findMany).not.toHaveBeenCalled();
  });
});

describe('attachments', () => {
  /**
   * Attachment now checks that each department belongs to the project of the entity: nothing previously
   * prevented placing a neighbouring project's step.
   */
  const inProject = (ids: number[]) => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({ projectId: 7 } as never);
    vi.mocked(prisma.shot.findUnique).mockResolvedValue({ projectId: 7 } as never);
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue({ projectId: 7 } as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ studioId: 1 } as never);
    // The check accepts the project's steps AND the studio's: a task often lives in a studio step, refusing
    // it would forbid assigning it.
    vi.mocked(prisma.department.findMany).mockResolvedValue(ids.map((id) => ({ id })) as never);
  };

  it("replaces an entity's list, without delta", async () => {
    inProject([1, 2]);
    await setHolderDepartments('asset', 5, [1, 2]);
    expect(prisma.asset.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { departments: { set: [{ id: 1 }, { id: 2 }] } },
    });
  });

  it('empties the list when nothing is sent', async () => {
    inProject([]);
    await setHolderDepartments('shot', 5, []);
    expect(prisma.shot.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { departments: { set: [] } },
    });
  });

  it('can target a sequence', async () => {
    inProject([3]);
    await setHolderDepartments('sequence', 8, [3]);
    expect(prisma.sequence.update).toHaveBeenCalled();
  });

  it('refuses the department of another project', async () => {
    // The missing check: an identifier taken elsewhere was placed without a murmur.
    inProject([1]);
    await expect(setHolderDepartments('asset', 5, [99])).rejects.toMatchObject({
      code: 'BAD_DEPARTMENT',
    });
    expect(prisma.asset.update).not.toHaveBeenCalled();
  });

  it('adds and removes without rewriting the whole list', async () => {
    inProject([1, 2]);
    await attachHolderDepartments('asset', 5, [2]);
    expect(prisma.asset.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { departments: { connect: [{ id: 2 }] } },
    });
    await detachHolderDepartments('asset', 5, [2]);
    expect(prisma.asset.update).toHaveBeenLastCalledWith({
      where: { id: 5 },
      data: { departments: { disconnect: [{ id: 2 }] } },
    });
  });

  it('sets the departments of a person', async () => {
    await setUserDepartments(4, [1]);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { departments: { set: [{ id: 1 }] } },
    });
  });
});

/**
 * A5-06: renumbers a pipe, and only one.
 *
 * `order` designates the latest version of a shot (`lib/pipelineOrder`): rewriting that of a neighbouring
 * project or of the studio reference changes the file presented as deliverable on shots we have not touched.
 * The batch must therefore be complete and homogeneous.
 */
describe('reorder: batch scope', () => {
  const rows = (...items: { id: number; studioId?: number; projectId?: number | null }[]) =>
    vi.mocked(prisma.department.findMany).mockResolvedValue(
      items.map((i) => ({
        id: i.id,
        studioId: i.studioId ?? 1,
        projectId: 'projectId' in i ? i.projectId : 7,
      })) as never,
    );

  it('refuses a batch that mixes two projects', async () => {
    rows({ id: 1, projectId: 7 }, { id: 2, projectId: 8 });
    await expect(reorder(ACTOR, [1, 2])).rejects.toMatchObject({ code: 'DEPARTMENT_SCOPE_MIX' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a batch that mixes the studio reference with a project', async () => {
    rows({ id: 1, projectId: null }, { id: 2, projectId: 7 });
    await expect(reorder(ACTOR, [1, 2])).rejects.toMatchObject({ code: 'DEPARTMENT_SCOPE_MIX' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an identifier that does not exist', async () => {
    rows({ id: 1 });
    await expect(reorder(ACTOR, [1, 404])).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('accepts a homogeneous batch and writes the position of each one', async () => {
    rows({ id: 3 }, { id: 1 }, { id: 2 });
    await reorder(ACTOR, [3, 1, 2]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.department.update).toHaveBeenNthCalledWith(1, { where: { id: 3 }, data: { order: 0 } });
    expect(prisma.department.update).toHaveBeenNthCalledWith(3, { where: { id: 2 }, data: { order: 2 } });
  });
});

/**
 * A5-03: the three structuring writes of the pipe leave a named trace.
 *
 * `order` is not decorative: it is what designates "the latest version" of a shot (`lib/pipelineOrder`).
 * Renaming, removing or renumbering a department changed the file presented as deliverable without the audit
 * log saying anything — neither what, nor by whom. The signature therefore takes the actor, which the caller
 * knows (`req.user`).
 */
describe('audit of pipe gestures', () => {
  it('logs an update, with its previous order', async () => {
    vi.mocked(prisma.department.findUnique).mockResolvedValueOnce(dept({ order: 3 }) as never);
    vi.mocked(prisma.department.update).mockResolvedValueOnce(dept({ order: 0 }) as never);
    await update(ACTOR, 1, { order: 0 });
    expect(audited).toHaveBeenCalledWith({
      userId: 42,
      action: 'DEPARTMENT_UPDATE',
      entityType: 'Department',
      entityId: 1,
      metadata: { key: 'ANIMATION', projectId: null, previousOrder: 3, changes: { order: 0 } },
    });
  });

  it('logs a removal', async () => {
    vi.mocked(prisma.department.findUnique).mockResolvedValueOnce(dept({ projectId: 7 }) as never);
    vi.mocked(prisma.department.update).mockResolvedValueOnce(dept() as never);
    await remove(ACTOR, 9);
    expect(audited).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, action: 'DEPARTMENT_DELETE', entityId: 9 }),
    );
  });

  it('logs a renumbering with the whole batch and its scope', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValue([
      { id: 3, studioId: 1, projectId: 7 },
      { id: 1, studioId: 1, projectId: 7 },
    ] as never);
    await reorder(ACTOR, [3, 1]);
    expect(audited).toHaveBeenCalledWith({
      userId: 42,
      action: 'DEPARTMENT_REORDER',
      entityType: 'Department',
      entityId: 3,
      metadata: { ids: [3, 1], studioId: 1, projectId: 7 },
    });
  });

  it('logs nothing when the batch is empty or refused', async () => {
    await reorder(ACTOR, []);
    vi.mocked(prisma.department.findMany).mockResolvedValue([
      { id: 1, studioId: 1, projectId: 7 },
      { id: 2, studioId: 1, projectId: 8 },
    ] as never);
    await expect(reorder(ACTOR, [1, 2])).rejects.toMatchObject({ code: 'DEPARTMENT_SCOPE_MIX' });
    expect(audited).not.toHaveBeenCalled();
  });
});
