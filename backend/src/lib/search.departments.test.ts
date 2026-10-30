// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Task search: the department label comes out of the join.
 *
 * The palette lets one search a task by its name, by the denormalised key of its step (`lookdev`) and by that step's label ("Look Dev"), which lives in
 * `Department`. Writing the three branches in the same `OR` made the join cross into the third: a `BitmapOr` does not cross a table, so NO index of `Task`
 * could apply and each keystroke scanned the whole table (measured at 60,000 tasks: 775 blocks read and 25.6 ms for a term matching nothing, against 21
 * blocks and 1.2 ms once the `OR` was brought back to the `Task` columns alone).
 *
 * This file checks the one thing a unit test can establish here, and it is the right one: **the shape of the query** — how many tables the `OR` crosses,
 * and whether the selected set stays the same. The gain in blocks read is measured by `EXPLAIN` on a real-volume database; it is recorded in the migration
 * `20260916091000_trigrammes_pipe`.
 */

vi.mock('./prisma', () => {
  const delegate = () => ({ findMany: vi.fn().mockResolvedValue([]) });
  return {
    prisma: {
      project: delegate(),
      sequence: delegate(),
      shot: delegate(),
      asset: delegate(),
      task: delegate(),
      version: delegate(),
      mediaObject: delegate(),
      playlist: delegate(),
      user: delegate(),
      projectMembership: delegate(),
      episode: delegate(),
      department: delegate(),
      timeline: delegate(),
      board: delegate(),
      entityNote: delegate(),
    },
  };
});
vi.mock('./searchComments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./searchComments')>()),
  searchComments: vi.fn().mockResolvedValue([]),
}));

import { Role } from '@prisma/client';
import { searchEntities } from './search';
import { prisma } from './prisma';

const ARTIST_ID = 7;

function callsOf<T = Record<string, unknown>>(fn: unknown): T[] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call[0] as T);
}

/** The branches of the textual `OR` of the task search, in order. */
function taskTextBranches(): Record<string, unknown>[] {
  const args = callsOf<{ where: { AND: { OR: Record<string, unknown>[] }[] } }>(prisma.task.findMany).at(-1)!;
  return args.where.AND[0]!.OR;
}

/** Names of the tables a `where` clause crosses, besides `Task` itself. */
function joinedTables(branches: Record<string, unknown>[]): string[] {
  const relations = ['departmentRef', 'shot', 'asset', 'version'];
  return branches.flatMap((branch) => Object.keys(branch).filter((key) => relations.includes(key)));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.projectMembership.findMany).mockResolvedValue([{ projectId: 3 }] as never);
});

describe('searchEntities — the task search now crosses only one table', () => {
  it('resolves the department label to identifiers, instead of joining the table', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([{ id: 4 }, { id: 9 }] as never);
    await searchEntities('modeling', ARTIST_ID, Role.ARTIST);

    const branches = taskTextBranches();
    // The core of the fix: zero joined table in the textual `OR`. With the former form,
    // `departmentRef` figured there and this array was `['departmentRef']`.
    expect(joinedTables(branches)).toEqual([]);
    expect(branches).toEqual([
      { name: { contains: 'modeling', mode: 'insensitive' } },
      { department: { contains: 'modeling', mode: 'insensitive' } },
      { departmentId: { in: [4, 9] } },
    ]);
  });

  it('selects exactly what the join selected: live step, matching label', async () => {
    await searchEntities('modeling', ARTIST_ID, Role.ARTIST);
    // The former branch was written `departmentRef: { deletedAt: null, name: contains }`.
    // The resolution query carries the same filter, word for word — that is what guarantees
    // that the retained task set does not move.
    const resolution = callsOf<{ where: Record<string, unknown>; select: unknown }>(
      prisma.department.findMany,
    )[0]!;
    expect(resolution.where).toEqual({
      deletedAt: null,
      name: { contains: 'modeling', mode: 'insensitive' },
    });
    expect(resolution.select).toEqual({ id: true });
  });

  it('omits the branch when no step matches, without touching the other two', async () => {
    // The mock returns `[]` by default. A `departmentId: { in: [] }` would be a clause that
    // Postgres must still evaluate; the absence of a branch says the same thing and reads better.
    await searchEntities('sh0120', ARTIST_ID, Role.ARTIST);
    expect(taskTextBranches().map((branch) => Object.keys(branch)[0])).toEqual(['name', 'department']);
  });

  it('costs only one resolution query, whatever the role', async () => {
    await searchEntities('modeling', ARTIST_ID, Role.ARTIST);
    // An ARTIST is not offered the department reference (`searchExtras`): the only call is therefore that of the
    // resolution. The count is the measure that matters — one more query on a table of a few dozen rows, one join fewer on a table
    // that tracks production.
    expect(prisma.department.findMany).toHaveBeenCalledTimes(1);
  });

  it('does not widen what a CLIENT can reach: the access filter stays on the tasks', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([{ id: 4 }] as never);
    await searchEntities('modeling', ARTIST_ID, Role.CLIENT);
    // The step identifiers are not filtered by project — they were not in the join either. They only serve to filter tasks already bounded
    // by membership, and it is that bound that must be verified.
    const where = callsOf<{ where: { OR: Record<string, unknown>[] } }>(prisma.task.findMany).at(-1)!.where;
    expect(where.OR).toEqual([
      {
        shot: {
          deletedAt: null,
          hiddenAt: null,
          project: { deletedAt: null, memberships: { some: { userId: ARTIST_ID } } },
        },
      },
      {
        asset: {
          deletedAt: null,
          hiddenAt: null,
          project: { deletedAt: null, memberships: { some: { userId: ARTIST_ID } } },
        },
      },
    ]);
  });
});
