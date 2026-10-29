// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: { task: { findMany: vi.fn(), count: vi.fn() } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn() }));

import { list, listForBoard, listForProject } from './TaskService';
import { decodeCursor, encodeCursor } from '../lib/pagination';

const page = { page: 1, pageSize: 100, order: 'desc' as const };

/** A task row as `listForBoard` projects it. */
const row = (id: number, order = 0) => ({
  id,
  order,
  name: `comp ${id}`,
  type: 'COMP',
  status: 'TODO',
  pipelineStatusId: null,
  department: 'comp',
  departmentId: 4,
  dueDate: null,
  assignee: null,
  _count: { versions: 0 },
  shot: { id: 100 + id, code: `SH0${id}`, sequenceId: 3 },
  asset: null,
});

const projectWhere = {
  OR: [{ shot: { projectId: 7, deletedAt: null } }, { asset: { projectId: 7, deletedAt: null } }],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.task.findMany.mockResolvedValue([]);
  db.task.count.mockResolvedValue(0);
});

describe('TaskService.list (tasks of a shot)', () => {
  it('breaks sort ties by id', async () => {
        // Tasks of an imported shot all share order = 0: without a tie-break, two successive
        // pages overlap.
    await list(page, 12);
    expect(db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('resumes after the cursor without accumulating the offset', async () => {
    await list({ ...page, page: 5, cursor: encodeCursor(2, 40) }, 12);
    const args = db.task.findMany.mock.calls[0]![0] as { skip: number; where: { AND: unknown[] } };
    expect(args.skip).toBe(0);
    expect(args.where.AND).toEqual([
      { OR: [{ order: { gt: 2 } }, { AND: [{ order: 2 }, { id: { gt: 40 } }] }] },
    ]);
  });

  it('returns the cursor of the last row on a full page', async () => {
    db.task.findMany.mockResolvedValue([row(1), row(2, 3)]);
    db.task.count.mockResolvedValue(9000);
    const res = await list({ ...page, pageSize: 2 }, 12);
    expect(res).toMatchObject({ total: 9000, hasMore: true });
    expect(decodeCursor(res.nextCursor ?? undefined)).toEqual({ value: 3, id: 2 });
  });
});

describe('TaskService.listForProject (upload destinations)', () => {
  it('caps by default and says what was not served', async () => {
        // The list was cut at 500 without returning anything that let the caller know: at ten thousand
        // tasks, the screen showed five hundred and said nothing.
    db.task.findMany.mockResolvedValue(new Array(500).fill(null).map((_, i) => row(i + 1)));
    db.task.count.mockResolvedValue(10000);
    const res = await listForProject(7);
    expect(db.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
    expect(res.total).toBe(10000);
    expect(res.truncated).toBe(true);
    expect(res.nextCursor).not.toBeNull();
  });

  it('does not declare itself truncated when everything fits', async () => {
    db.task.findMany.mockResolvedValue([row(1), row(2)]);
    db.task.count.mockResolvedValue(2);
    const res = await listForProject(7);
    expect(res.truncated).toBe(false);
    expect(res.nextCursor).toBeNull();
  });

  it('counts the whole project, not the page', async () => {
    await listForProject(7, { ...page, pageSize: 50, cursor: encodeCursor(0, 3) });
    expect(db.task.count).toHaveBeenCalledWith({ where: projectWhere });
    expect(db.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('keeps the row shape expected by the upload screen', async () => {
    db.task.findMany.mockResolvedValue([{ ...row(1), _count: { versions: 4 } }]);
    db.task.count.mockResolvedValue(1);
    const { items } = await listForProject(7);
    expect(items[0]).toEqual({
      id: 1,
      name: 'comp 1',
      department: 'comp',
      pipelineStatusId: null,
      parentKind: 'shot',
      parentName: 'SH01',
      versionCount: 4,
    });
  });
});

describe('TaskService.listForBoard (kanban)', () => {
  it('does not overwrite the shot/asset OR with the cursor condition', async () => {
        // Spreading the cursor at the root of the `where` would drop the project filter: the kanban
        // would show the tasks of the whole studio.
    await listForBoard(7, 2000, encodeCursor(0, 55));
    const args = db.task.findMany.mock.calls[0]![0] as { where: { OR: unknown[]; AND: unknown[] } };
    expect(args.where.OR).toEqual(projectWhere.OR);
    expect(args.where.AND).toEqual([
      { OR: [{ order: { gt: 0 } }, { AND: [{ order: 0 }, { id: { gt: 55 } }] }] },
    ]);
  });

  it('breaks sort ties by id', async () => {
    await listForBoard(7);
    expect(db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ order: 'asc' }, { name: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('keeps the historical meaning of `truncated` without a cursor', async () => {
    db.task.findMany.mockResolvedValue([row(1), row(2)]);
    db.task.count.mockResolvedValue(2);
    expect((await listForBoard(7)).truncated).toBe(false);
    db.task.count.mockResolvedValue(4000);
    expect((await listForBoard(7)).truncated).toBe(true);
  });

  it('with a cursor, `truncated` answers "is there another page left?"', async () => {
    db.task.findMany.mockResolvedValue([row(1), row(2)]);
    db.task.count.mockResolvedValue(4000);
    const res = await listForBoard(7, 2, encodeCursor(0, 1));
    expect(res.truncated).toBe(true);
    expect(decodeCursor(res.nextCursor ?? undefined)).toEqual({ value: 0, id: 2 });
  });

  it('always excludes tasks whose parent is in the trash', async () => {
    db.task.findMany.mockResolvedValue([row(1), { ...row(2), shot: null, asset: null }]);
    db.task.count.mockResolvedValue(2);
    const { items } = await listForBoard(7);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 1, parentKind: 'shot', parentLabel: 'SH01', sequenceId: 3 });
  });
});
