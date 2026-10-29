// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    shot: { findMany: vi.fn(), count: vi.fn() },
    task: { findMany: vi.fn() },
    version: { groupBy: vi.fn() },
    department: { findMany: vi.fn() },
    project: { findUnique: vi.fn() },
  },
}));

import {
  buildGridRows,
  cellStatusOf,
  getProjectGrid,
  gridShotWhere,
  gridTaskFilter,
  GRID_DEFAULT_LIMIT,
  GRID_MAX_LIMIT,
  type GridDepartment,
  type GridShotRow,
  type GridTaskRow,
} from './GridService';
import { prisma } from '../lib/prisma';
import { decodeCursor } from '../lib/pagination';
import { TaskStatus } from '@prisma/client';

const departments: GridDepartment[] = [
  { id: 1, key: 'anim', name: 'Animation', color: '#22C55E', order: 0 },
  { id: 2, key: 'comp', name: 'Compositing', color: null, order: 1 },
];

const shot = (over: Partial<GridShotRow> = {}): GridShotRow => ({
  id: 10,
  code: 'SH010',
  name: 'plan A',
  order: 0,
  sequenceId: 3,
  sequence: { code: 'SQ010', episodeId: 5, episode: { code: 'EP01' } },
  pipelineStatus: { id: 90, code: 'ip', name: 'In Progress', color: '#3B82F6' },
  departments: [{ id: 1 }],
  ...over,
});

const task = (over: Partial<GridTaskRow> = {}): GridTaskRow => ({
  id: 100,
  shotId: 10,
  status: TaskStatus.IN_PROGRESS,
  dueDate: null,
  department: 'anim',
  departmentId: 1,
  departmentRef: { key: 'anim' },
  assignee: { id: 7, name: 'Ada' },
  pipelineStatus: null,
  ...over,
});

// ── Filters ──────────────────────────────────────────────────────────────────

describe('GridService: filters', () => {
  it('without a task filter, the grid only filters live and visible shots', () => {
    expect(gridShotWhere(7, {})).toEqual({ projectId: 7, deletedAt: null, hiddenAt: null });
    expect(gridTaskFilter({})).toBeNull();
  });

  it('looks up the department by its KEY, relation first, denormalised column next', () => {
    expect(gridTaskFilter({ department: 'comp' })).toEqual({
      AND: [{ OR: [{ departmentRef: { key: 'comp' } }, { department: 'comp' }] }],
    });
  });

  it('filters on the requested assignee', () => {
    expect(gridTaskFilter({ assigneeId: 7 })).toEqual({ AND: [{ assigneeId: 7 }] });
  });

  it('accepts the studio code AND the enum value for a studio without a reference', () => {
    expect(gridTaskFilter({ status: 'ip' })).toEqual({
      AND: [{ OR: [{ pipelineStatus: { code: 'ip' } }] }],
    });
    // `todo` also designates the frozen enum: the local branch is added to it, it does not replace it.
    expect(gridTaskFilter({ status: 'todo' })).toEqual({
      AND: [
        {
          OR: [{ pipelineStatus: { code: 'todo' } }, { pipelineStatusId: null, status: TaskStatus.TODO }],
        },
      ],
    });
  });

  it('a task filter keeps the ENTIRE shot: it decides the row, not the cells', () => {
    const where = gridShotWhere(7, { assigneeId: 7, sequenceId: 3, episodeId: 5 });
    expect(where.sequenceId).toBe(3);
    expect(where.sequence).toEqual({ episodeId: 5 });
    expect(where.tasks).toEqual({ some: { AND: [{ assigneeId: 7 }] } });
  });
});

// ── Row assembly ─────────────────────────────────────────────────────────────

describe('GridService: buildGridRows', () => {
  it('returns one cell per department of the reference, even without a task', () => {
    const [row] = buildGridRows([shot()], [], [], departments);
    expect(row!.cells.map((c) => c.departmentKey)).toEqual(['anim', 'comp']);
    expect(row!.cells[1]).toMatchObject({ taskId: null, status: null, versionCount: 0 });
  });

  it('carries up the sequence, the episode and the shot\'s own status', () => {
    const [row] = buildGridRows([shot()], [], [], departments);
    expect(row).toMatchObject({
      shotId: 10,
      sequenceId: 3,
      sequenceCode: 'SQ010',
      episodeId: 5,
      episodeCode: 'EP01',
      status: { id: 90, code: 'ip', name: 'In Progress', color: '#3B82F6' },
    });
  });

  it('a shot outside any sequence has neither sequence nor episode, and keeps its columns', () => {
    const [row] = buildGridRows([shot({ sequenceId: null, sequence: null })], [], [], departments);
    expect(row).toMatchObject({ sequenceId: null, sequenceCode: null, episodeId: null, episodeCode: null });
    expect(row!.cells).toHaveLength(2);
  });

  it('attaches the version aggregate to the right cell', () => {
    const [row] = buildGridRows(
      [shot()],
      [task({ dueDate: new Date('2026-10-01T00:00:00Z') })],
      [{ taskId: 100, count: 3, lastAt: new Date('2026-09-12T08:00:00Z') }],
      departments,
    );
    expect(row!.cells[0]).toMatchObject({
      taskId: 100,
      versionCount: 3,
      lastActivityAt: '2026-09-12T08:00:00.000Z',
      dueDate: '2026-10-01T00:00:00.000Z',
      assignee: { id: 7, name: 'Ada' },
    });
  });

  it('when a department carries several tasks, the cell shows the first in the pipe', () => {
    // The tasks arrive sorted by (order, id): the first one wins the cell.
    const [row] = buildGridRows([shot()], [task({ id: 100 }), task({ id: 101 })], [], departments);
    expect(row!.cells[0]!.taskId).toBe(100);
  });

  it('matches the denormalised key regardless of case', () => {
    const [row] = buildGridRows(
      [shot()],
      [task({ departmentRef: null, department: 'ANIM' })],
      [],
      departments,
    );
    expect(row!.cells[0]!.taskId).toBe(100);
  });

  it('a task outside the reference has no column: it does not invent a cell for itself', () => {
    const [row] = buildGridRows(
      [shot()],
      [task({ departmentId: 99, departmentRef: { key: 'groom' }, department: 'groom' })],
      [],
      departments,
    );
    expect(row!.cells.every((c) => c.taskId === null)).toBe(true);
    expect(row!.cells.map((c) => c.departmentKey)).toEqual(['anim', 'comp']);
  });

  it('`scheduled` distinguishes "nothing to do here" from "to do, not started"', () => {
    // The shot is on the `anim` schedule only; `comp` has neither a task nor a schedule.
    const [row] = buildGridRows([shot({ departments: [{ id: 1 }] })], [], [], departments);
    expect(row!.cells.map((c) => c.scheduled)).toEqual([true, false]);
  });

  it('an existing task counts as scheduled, even outside ShotDepartments', () => {
    const [row] = buildGridRows(
      [shot({ departments: [] })],
      [task({ departmentId: 2, departmentRef: { key: 'comp' }, department: 'comp' })],
      [],
      departments,
    );
    expect(row!.cells.map((c) => c.scheduled)).toEqual([false, true]);
  });

  it('ignores an asset task that strayed into the batch (null shotId)', () => {
    const [row] = buildGridRows([shot()], [task({ shotId: null })], [], departments);
    expect(row!.cells[0]!.taskId).toBeNull();
  });
});

describe('GridService: cell status', () => {
  it('without a reference, writes NO label: the enum code and the family are enough', () => {
    expect(cellStatusOf(task())).toEqual({
      id: null,
      code: 'IN_PROGRESS',
      name: '',
      color: null,
      family: 'progress',
    });
  });

  it('with a reference, returns the studio\'s vocabulary and tint', () => {
    const status = cellStatusOf(
      task({
        status: TaskStatus.IN_PROGRESS,
        pipelineStatus: {
          id: 5,
          code: 'fin',
          name: 'Final',
          color: '#16A34A',
          isDone: true,
          isInactive: false,
          legacyStatus: TaskStatus.APPROVED,
        },
      }),
    );
    // `isDone` is authoritative on "finished", not the local enum.
    expect(status).toEqual({ id: 5, code: 'fin', name: 'Final', color: '#16A34A', family: 'done' });
  });

  it('an inactive status remains inactive: neither to do, nor done', () => {
    expect(
      cellStatusOf(
        task({
          pipelineStatus: {
            id: 6,
            code: 'omt',
            name: 'Omitted',
            color: '#71717A',
            isDone: false,
            isInactive: true,
            legacyStatus: null,
          },
        }),
      ).family,
    ).toBe('inactive');
  });
});

// ── Paginated read ───────────────────────────────────────────────────────────

const shots = (count: number): GridShotRow[] =>
  Array.from({ length: count }, (_, i) => shot({ id: i + 1, order: i, code: `SH${i + 1}` }));

describe('GridService: getProjectGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.shot.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shot.count).mockResolvedValue(0);
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.version.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.department.findMany).mockResolvedValue(departments as never);
  });

  it('paginates PER SHOT: take on the shots, sort from the index, never a take on the tasks', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(shots(3) as never);
    await getProjectGrid(7);
    const call = vi.mocked(prisma.shot.findMany).mock.calls[0]![0]!;
    expect(call.take).toBe(GRID_DEFAULT_LIMIT);
    expect(call.orderBy).toEqual([{ order: 'asc' }, { id: 'asc' }]);
    // A grid row is a shot with all its cells: bounding the tasks would cut a row in two.
    expect(vi.mocked(prisma.task.findMany).mock.calls[0]![0]!.take).toBeUndefined();
  });

  it('caps the page and refuses absurd values', async () => {
    await getProjectGrid(7, { limit: 5000 });
    expect(vi.mocked(prisma.shot.findMany).mock.calls[0]![0]!.take).toBe(GRID_MAX_LIMIT);
    await getProjectGrid(7, { limit: 0 });
    expect(vi.mocked(prisma.shot.findMany).mock.calls[1]![0]!.take).toBe(1);
  });

  it('reads the database only four times per page, plus the total and the reference', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(shots(2) as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([task()] as never);
    await getProjectGrid(7);
    expect(vi.mocked(prisma.shot.findMany)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.task.findMany)).toHaveBeenCalledTimes(1);
    // Counts AND last activity in a single aggregation, not one query per task.
    expect(vi.mocked(prisma.version.groupBy)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.shot.count)).toHaveBeenCalledTimes(1);
  });

  it('requests neither tasks nor versions when the page is empty', async () => {
    await getProjectGrid(7);
    expect(vi.mocked(prisma.task.findMany)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.version.groupBy)).not.toHaveBeenCalled();
  });

  it('counts the total without the cursor — otherwise it would shrink from page to page', async () => {
    vi.mocked(prisma.shot.count).mockResolvedValue(2000);
    const out = await getProjectGrid(7, { cursor: 'nawak', limit: 10 });
    expect(out.total).toBe(2000);
    expect(vi.mocked(prisma.shot.count).mock.calls[0]![0]!.where).toEqual(gridShotWhere(7, {}));
  });

  it('returns a cursor on (order, id) when the page is full', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(shots(2) as never);
    const out = await getProjectGrid(7, { limit: 2 });
    expect(decodeCursor(out.nextCursor!)).toEqual({ value: 1, id: 2 });
  });

  it('closes the list on an incomplete page', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(shots(2) as never);
    expect((await getProjectGrid(7, { limit: 10 })).nextCursor).toBeNull();
  });

  it('stacks the cursor into AND, without overwriting the relation clauses', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(shots(1) as never);
    const page = await getProjectGrid(7, { limit: 1 });
    await getProjectGrid(7, { limit: 1, cursor: page.nextCursor!, assigneeId: 7 });
    const where = vi.mocked(prisma.shot.findMany).mock.calls[1]![0]!.where as Record<string, unknown>;
    // The task filter survives the cursor: spread at the root, it would be overwritten and the page would
    // return the whole project.
    expect(where.tasks).toEqual({ some: { AND: [{ assigneeId: 7 }] } });
    expect(where.AND).toEqual([{ OR: [{ order: { gt: 0 } }, { AND: [{ order: 0 }, { id: { gt: 1 } }] }] }]);
  });

  it('falls back on the studio reference when the project does not have its own', async () => {
    vi.mocked(prisma.department.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(departments as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ studioId: 4 } as never);
    const out = await getProjectGrid(7);
    expect(out.departments).toEqual(departments);
    expect(vi.mocked(prisma.department.findMany).mock.calls[1]![0]!.where).toEqual({
      studioId: 4,
      projectId: null,
      deletedAt: null,
    });
  });

  it('returns no column for a project that no longer exists', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
    expect((await getProjectGrid(7)).departments).toEqual([]);
  });
});
