// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: { task: { findMany: vi.fn() } } }));

import { prisma } from '../lib/prisma';
import {
  getProjectSchedule,
  scheduleWindowFilter,
  toScheduleTask,
  SCHEDULE_MAX_TASKS,
  type ScheduleRow,
} from './ScheduleService';

const findMany = vi.mocked(prisma.task.findMany) as unknown as ReturnType<typeof vi.fn>;

const base: ScheduleRow = {
  id: 1,
  name: 'anim',
  type: 'ANIMATION',
  status: 'IN_PROGRESS',
  startDate: new Date('2026-07-13T00:00:00Z'),
  dueDate: new Date('2026-07-20T00:00:00Z'),
  assignee: { id: 9, name: 'Ada' },
  shot: { code: 'SH020', sequence: { id: 3, code: 'SQ010' } },
  asset: null,
  pipelineStatus: null,
};

/** A studio status, as the ShotGrid synchronisation writes it. */
const studioStatus = {
  id: 42,
  code: 'ip',
  name: 'In Progress',
  color: '#3B82F6',
  isDone: false,
  isInactive: false,
  legacyStatus: 'IN_PROGRESS' as const,
};

/** Set of distinct rows, to check that exactly what was read is returned. */
const rows = (count: number): ScheduleRow[] =>
  Array.from({ length: count }, (_, i) => ({ ...base, id: i + 1, name: `task-${i + 1}` }));

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

describe('ScheduleService: toScheduleTask', () => {
  it('builds the shot location with its sequence and exposes ISO dates', () => {
    const t = toScheduleTask(base);
    expect(t.location).toBe('SQ010 · SH020');
    expect(t.sequenceId).toBe(3);
    expect(t.sequenceCode).toBe('SQ010');
    expect(t.dueDate).toBe('2026-07-20T00:00:00.000Z');
    expect(t.startDate).toBe('2026-07-13T00:00:00.000Z');
    expect(t.assignee).toEqual({ id: 9, name: 'Ada' });
  });

  it('returns the studio status, colour included: the Gantt no longer colours by enum', () => {
    const t = toScheduleTask({ ...base, pipelineStatus: studioStatus });
    expect(t.pipelineStatus).toEqual({ id: 42, code: 'ip', name: 'In Progress', color: '#3B82F6' });
    expect(t.family).toBe('progress');
  });

  it('without a reference list, the family comes from the enum and the studio status is null', () => {
    const t = toScheduleTask(base);
    expect(t.pipelineStatus).toBeNull();
    expect(t.family).toBe('progress');
  });

  it('a terminal studio status counts as done, even if the enum says otherwise', () => {
    const t = toScheduleTask({
      ...base,
      status: 'IN_PROGRESS',
      pipelineStatus: { ...studioStatus, code: 'fin', name: 'Final', isDone: true },
    });
    expect(t.family).toBe('done');
    expect(t.pipelineStatus!.code).toBe('fin');
  });

  it('asks the database for the studio status', async () => {
    await getProjectSchedule(7);
    const select = findMany.mock.calls[0]![0].select as Record<string, unknown>;
    expect(select.pipelineStatus).toBeDefined();
  });

  it('handles a shot without a sequence', () => {
    const t = toScheduleTask({ ...base, shot: { code: 'SH999', sequence: null } });
    expect(t.location).toBe('SH999');
    expect(t.sequenceId).toBeNull();
  });

  it('uses the asset name and handles missing dates/assignee', () => {
    const t = toScheduleTask({
      ...base,
      shot: null,
      asset: { name: 'Robot' },
      startDate: null,
      dueDate: null,
      assignee: null,
    });
    expect(t.location).toBe('Robot');
    expect(t.startDate).toBeNull();
    expect(t.dueDate).toBeNull();
    expect(t.assignee).toBeNull();
  });
});

describe('ScheduleService: time window', () => {
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-12-01T00:00:00Z');

  it('without a bound, adds no clause: the read stays as before', () => {
    expect(scheduleWindowFilter({})).toEqual([]);
  });

  it('keeps a task that overflows the window on both sides (overlap, not due date)', () => {
    // Two clauses: effective end >= from, effective start <= to. A task that started before
    // the window and is due after it satisfies both: this is the case a filter on the due date alone would lose.
    expect(scheduleWindowFilter({ from, to })).toEqual([
      { OR: [{ dueDate: { gte: from } }, { dueDate: null, startDate: { gte: from } }] },
      { OR: [{ startDate: { lte: to } }, { startDate: null, dueDate: { lte: to } }] },
    ]);
  });

  it('takes the missing bound from the other date', () => {
    expect(scheduleWindowFilter({ from })).toEqual([
      { OR: [{ dueDate: { gte: from } }, { dueDate: null, startDate: { gte: from } }] },
    ]);
    expect(scheduleWindowFilter({ to })).toEqual([
      { OR: [{ startDate: { lte: to } }, { startDate: null, dueDate: { lte: to } }] },
    ]);
  });

  it('passes the window to the where clause, in addition to the project and date filters', async () => {
    await getProjectSchedule(7, { from, to });
    const where = findMany.mock.calls[0]![0].where as { AND: unknown[] };
    expect(where.AND).toHaveLength(4);
    expect(where.AND.slice(2)).toEqual(scheduleWindowFilter({ from, to }));
  });
});

describe('ScheduleService: safety cap', () => {
  it('bounds the read: never more than SCHEDULE_MAX_TASKS + 1 rows requested', async () => {
    // The measure of the fix: the number of rows fetched. Without `take`, the query returned the
    // whole dated project (eight thousand rows on a feature film).
    await getProjectSchedule(7);
    expect(findMany.mock.calls[0]![0].take).toBe(SCHEDULE_MAX_TASKS + 1);
  });

  it('closes the sort with id so the truncation is reproducible', async () => {
    await getProjectSchedule(7);
    expect(findMany.mock.calls[0]![0].orderBy).toEqual([
      { dueDate: 'asc' },
      { startDate: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('at exactly the cap, returns everything and does not warn', async () => {
    findMany.mockResolvedValue(rows(SCHEDULE_MAX_TASKS));
    const out = await getProjectSchedule(7);
    expect(out.tasks).toHaveLength(SCHEDULE_MAX_TASKS);
    expect(out.truncated).toBe(false);
    expect(out.limit).toBe(SCHEDULE_MAX_TASKS);
  });

  it('beyond it, cuts at the cap and says so', async () => {
    findMany.mockResolvedValue(rows(SCHEDULE_MAX_TASKS + 1));
    const out = await getProjectSchedule(7);
    expect(out.tasks).toHaveLength(SCHEDULE_MAX_TASKS);
    expect(out.truncated).toBe(true);
    // The probe row only serves to detect overflow: it is not returned.
    expect(out.tasks.at(-1)!.id).toBe(SCHEDULE_MAX_TASKS);
  });

  it('below it, returns exactly the rows read, in order, as converted', async () => {
    const read = rows(3);
    findMany.mockResolvedValue(read);
    const out = await getProjectSchedule(7);
    expect(out.tasks).toEqual(read.map(toScheduleTask));
  });
});
