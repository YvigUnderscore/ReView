// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    sequence: { findMany: vi.fn() },
    task: { findMany: vi.fn(), count: vi.fn() },
  },
}));

import {
  buildMatrix,
  buildPace,
  buildWorkload,
  findAttention,
  getOverview,
  projectEnd,
  weekStartOf,
  type ProductionTask,
} from './ProductionService';
import { prisma } from '../lib/prisma';
import { TaskStatus } from '@prisma/client';

const NOW = new Date('2026-08-18T12:00:00Z'); // a Tuesday

const task = (over: Partial<ProductionTask> = {}): ProductionTask => ({
  id: 1,
  name: 'comp',
  status: TaskStatus.TODO,
  dueDate: null,
  assigneeId: null,
  assigneeName: null,
  department: 'comp',
  sequenceId: 1,
  sequenceCode: 'SQ010',
  parentLabel: 'SH010',
  ...over,
});

describe('buildMatrix', () => {
  it('crosses sequence and department, and counts by family', () => {
    const cells = buildMatrix([
      task({ id: 1, status: TaskStatus.TODO }),
      task({ id: 2, status: TaskStatus.APPROVED }),
      task({ id: 3, status: TaskStatus.RETAKE, department: 'anim' }),
    ]);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({ sequenceId: 1, department: 'comp', todo: 1, done: 1, total: 2 });
    expect(cells[1]).toMatchObject({ department: 'anim', blocked: 1, total: 1 });
  });

  it('groups together what has neither a sequence nor a department', () => {
    const cells = buildMatrix([
      task({ id: 1, sequenceId: null, department: null }),
      task({ id: 2, sequenceId: null, department: null, status: TaskStatus.IN_PROGRESS }),
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ sequenceId: null, department: null, todo: 1, progress: 1 });
  });

  it('adds up the rows already counted in the database, one identical cell for N tasks', () => {
    const grouped = buildMatrix([
      { sequenceId: 1, department: 'comp', status: TaskStatus.TODO, count: 3 },
      { sequenceId: 1, department: 'comp', status: TaskStatus.APPROVED, count: 2 },
    ]);
    const oneByOne = buildMatrix([
      ...Array.from({ length: 3 }, (_, i) => task({ id: i, status: TaskStatus.TODO })),
      ...Array.from({ length: 2 }, (_, i) => task({ id: 10 + i, status: TaskStatus.APPROVED })),
    ]);
    expect(grouped).toEqual(oneByOne);
    expect(grouped[0]).toMatchObject({ todo: 3, done: 2, total: 5 });
  });

  it('removes inactive statuses from the gauges — neither to do nor done', () => {
    const cells = buildMatrix([
      { sequenceId: 1, department: 'comp', status: TaskStatus.TODO, count: 4 },
      { sequenceId: 1, department: 'comp', status: TaskStatus.TODO, family: 'inactive', count: 6 },
    ]);
    expect(cells[0]).toMatchObject({ todo: 4, total: 4 });
  });

  it('counts as done the status the studio declares terminal', () => {
    // "fin" on the ShotGrid side: the local enum still says IN_PROGRESS.
    const cells = buildMatrix([
      { sequenceId: 1, department: 'comp', status: TaskStatus.IN_PROGRESS, family: 'done', count: 2 },
    ]);
    expect(cells[0]).toMatchObject({ done: 2, progress: 0, total: 2 });
  });
});

describe('findAttention', () => {
  const yesterday = new Date('2026-08-17T12:00:00Z');
  const tomorrow = new Date('2026-08-19T12:00:00Z');

  it('flags overdue deadlines, the oldest first', () => {
    const older = new Date('2026-08-10T12:00:00Z');
    const found = findAttention(
      [
        task({ id: 1, dueDate: yesterday }),
        task({ id: 2, dueDate: older }),
        task({ id: 3, dueDate: tomorrow }),
      ],
      NOW,
    );
    expect(found.overdue.map((t) => t.id)).toEqual([2, 1]);
  });

  it('never counts a finished task as late', () => {
    // Its date has passed, but the work is done: flagging it would drown what matters.
    const found = findAttention([task({ id: 1, status: TaskStatus.APPROVED, dueDate: yesterday })], NOW);
    expect(found.overdue).toEqual([]);
    expect(found.unassigned).toEqual([]);
  });

  it('likewise excludes an inactive task, omitted or not applicable', () => {
    const found = findAttention(
      [task({ id: 1, status: TaskStatus.TODO, family: 'inactive', dueDate: yesterday })],
      NOW,
    );
    expect(found.overdue).toEqual([]);
    expect(found.unassigned).toEqual([]);
  });

  it('separates unassigned tasks and those awaiting review', () => {
    const found = findAttention(
      [
        task({ id: 1, assigneeId: null }),
        task({ id: 2, assigneeId: 7 }),
        task({ id: 3, assigneeId: 7, status: TaskStatus.PENDING_REVIEW }),
      ],
      NOW,
    );
    expect(found.unassigned.map((t) => t.id)).toEqual([1]);
    expect(found.waitingReview.map((t) => t.id)).toEqual([3]);
  });

  it('recognises the wait for a verdict of a custom status', () => {
    // "suprev" status on the site: the local enum knows nothing of it, the family does.
    const found = findAttention(
      [task({ id: 4, assigneeId: 7, status: TaskStatus.IN_PROGRESS, family: 'review' })],
      NOW,
    );
    expect(found.waitingReview.map((t) => t.id)).toEqual([4]);
  });

  it('bounds each list, a page is not read at five hundred lines', () => {
    const many = Array.from({ length: 80 }, (_, i) => task({ id: i, assigneeId: null }));
    expect(findAttention(many, NOW, 10).unassigned).toHaveLength(10);
  });
});

describe('buildWorkload', () => {
  it('counts what remains to be done, per person', () => {
    const rows = buildWorkload(
      [
        task({ id: 1, assigneeId: 7, assigneeName: 'Ada', status: TaskStatus.IN_PROGRESS }),
        task({ id: 2, assigneeId: 7, assigneeName: 'Ada', status: TaskStatus.TODO }),
        task({ id: 3, assigneeId: 8, assigneeName: 'Bo', status: TaskStatus.PENDING_REVIEW }),
      ],
      NOW,
    );
    expect(rows.map((r) => [r.name, r.total])).toEqual([
      ['Ada', 2],
      ['Bo', 1],
    ]);
    expect(rows[0]).toMatchObject({ todo: 1, progress: 1 });
  });

  it('excludes finished work — the load is what remains', () => {
    expect(buildWorkload([task({ assigneeId: 7, status: TaskStatus.APPROVED })], NOW)).toEqual([]);
    expect(
      buildWorkload([task({ assigneeId: 7, status: TaskStatus.TODO, family: 'inactive' })], NOW),
    ).toEqual([]);
  });

  it("counts each person's delays", () => {
    const late = new Date('2026-08-01T12:00:00Z');
    const rows = buildWorkload([task({ assigneeId: 7, assigneeName: 'Ada', dueDate: late })], NOW);
    expect(rows[0]?.overdue).toBe(1);
  });

  it('takes up the delays already counted in the database rather than re-reading dates', () => {
    const rows = buildWorkload(
      [
        { assigneeId: 7, assigneeName: 'Ada', status: TaskStatus.TODO, count: 9, overdue: 4 },
        { assigneeId: 7, assigneeName: 'Ada', status: TaskStatus.PENDING_REVIEW, count: 1, overdue: 0 },
      ],
      NOW,
    );
    expect(rows[0]).toMatchObject({ todo: 9, review: 1, total: 10, overdue: 4 });
  });

  it('places unassigned tasks last, however many there are', () => {
    const rows = buildWorkload(
      [
        ...Array.from({ length: 5 }, (_, i) => task({ id: i, assigneeId: null })),
        task({ id: 99, assigneeId: 7, assigneeName: 'Ada' }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.assigneeId)).toEqual([7, null]);
  });
});

describe('weekStartOf', () => {
  it('brings back to Monday, including from a Sunday', () => {
    expect(weekStartOf(new Date('2026-08-18T12:00:00Z')).toISOString()).toBe('2026-08-17T00:00:00.000Z');
    expect(weekStartOf(new Date('2026-08-23T23:00:00Z')).toISOString()).toBe('2026-08-17T00:00:00.000Z');
    expect(weekStartOf(new Date('2026-08-17T00:00:00Z')).toISOString()).toBe('2026-08-17T00:00:00.000Z');
  });
});

describe('buildPace', () => {
  it('returns one week per slot, empty ones included', () => {
    const points = buildPace([], NOW, 4);
    expect(points.map((p) => p.weekStart)).toEqual(['2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17']);
    expect(points.every((p) => p.count === 0)).toBe(true);
  });

  it('places each delivery in its week', () => {
    // The same three deliveries as before, already grouped by the database: two in the week of the 17th
    // (Tuesday 18 and Monday 17), one in that of the 10th.
    const points = buildPace(
      [
        { weekStart: '2026-08-17', count: 2 },
        { weekStart: '2026-08-10', count: 1 },
      ],
      NOW,
      4,
    );
    expect(points.map((p) => p.count)).toEqual([0, 0, 1, 2]);
  });

  it('ignores what falls outside the window rather than attaching it to the edge', () => {
    expect(buildPace([{ weekStart: '2025-12-29', count: 1 }], NOW, 4).every((p) => p.count === 0)).toBe(true);
  });
});

describe('projectEnd', () => {
  const points = [
    { weekStart: '2026-08-03', count: 4 },
    { weekStart: '2026-08-10', count: 6 },
  ];

  it('projects the end at the observed pace', () => {
    const p = projectEnd(10, 30, points, NOW);
    expect(p.perWeek).toBe(5);
    // 20 remaining at 5/week = 4 weeks.
    expect(p.projectedEnd).toBe('2026-09-15');
  });

  it('projects nothing without a pace — an invented date would be read as a commitment', () => {
    const flat = projectEnd(10, 30, [{ weekStart: '2026-08-10', count: 0 }], NOW);
    expect(flat.projectedEnd).toBeNull();
    // The reason matters as much as the absence: the screen must be able to say "we do not know" rather than
    // leave a blank that reads as "soon".
    expect(flat.unavailable).toBe('no-velocity');
    expect(projectEnd(10, 30, [], NOW).unavailable).toBe('no-velocity');
  });

  it('projects nothing when everything is done, and says so differently', () => {
    const done = projectEnd(30, 30, points, NOW);
    expect(done.projectedEnd).toBeNull();
    expect(done.unavailable).toBe('nothing-left');
  });

  it('declares its unit: the projection divides tasks by tasks', () => {
    expect(projectEnd(10, 30, points, NOW).unit).toBe('tasks');
  });
});

// ── Assembly: what getOverview asks of the database, and what it does with it ──

const NO_STATUS = { isDone: null, isInactive: null, legacyStatus: null };

/**
 * Returns the response matching the SQL recognised in the tagged template.
 *
 * `pace` and `delivery` both group by `date_trunc`: what distinguishes them is the table read — review
 * decisions for the velocity, media for the output rate.
 */
function stubQueryRaw(answers: {
  matrix?: unknown[];
  workload?: unknown[];
  pace?: unknown[];
  delivery?: unknown[];
}) {
  vi.mocked(prisma.$queryRaw).mockImplementation(((strings: TemplateStringsArray) => {
    const sql = strings.join(' ');
    if (sql.includes('ReviewDecision')) return Promise.resolve(answers.pace ?? []);
    if (sql.includes('MediaObject')) return Promise.resolve(answers.delivery ?? []);
    if (sql.includes('"assigneeId"')) return Promise.resolve(answers.workload ?? []);
    return Promise.resolve(answers.matrix ?? []);
  }) as never);
}

describe('getOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubQueryRaw({});
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.task.count).mockResolvedValue(0);
  });

  it('reads only aggregates: four raw queries, the sequences, three bounded lists', async () => {
    await getOverview(7, 8, NOW);
    expect(vi.mocked(prisma.$queryRaw)).toHaveBeenCalledTimes(4);
    expect(vi.mocked(prisma.sequence.findMany)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.task.findMany)).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(prisma.task.findMany).mock.calls) {
      expect(call[0]!.take).toBe(50);
    }
  });

  it('counts the totals in the database instead of measuring capped lists', async () => {
    // A project where each list exceeds the cap: the tiles must announce 300, not 50.
    vi.mocked(prisma.task.count).mockResolvedValue(300);
    const view = await getOverview(7, 8, NOW);
    expect(vi.mocked(prisma.task.count)).toHaveBeenCalledTimes(4);
    expect(view.attention.totals).toEqual({
      overdue: 300,
      unassigned: 300,
      waitingReview: 300,
      blocking: 300,
    });
    expect(view.attention.limit).toBe(50);
  });

  it('de-duplicates the badge: it is counted in the database over the union, not summed', async () => {
    // The fourth `count` is that of the badge. A task both late and unassigned must appear there only once: 5
    // + 9 + 6 = 20, but the union is worth 14.
    const counts = [5, 9, 6, 14];
    let call = 0;
    vi.mocked(prisma.task.count).mockImplementation((() => Promise.resolve(counts[call++] ?? 0)) as never);
    const view = await getOverview(7, 8, NOW);
    expect(view.attention.totals.blocking).toBe(14);
    const { overdue, unassigned, waitingReview } = view.attention.totals;
    expect(overdue + unassigned + waitingReview).toBe(20);
    // The badge's where is indeed a union of the three conditions, not a conjunction.
    const badge = JSON.stringify(vi.mocked(prisma.task.count).mock.calls[3]![0]!.where);
    expect(badge).toContain('"assigneeId":null');
    expect(badge).toContain('"dueDate"');
  });

  it('separates the two units: velocity in tasks, output rate in media', async () => {
    stubQueryRaw({
      matrix: [
        { sequenceId: 1, department: 'comp', status: TaskStatus.TODO, count: 10, ...NO_STATUS },
        { sequenceId: 1, department: 'comp', status: TaskStatus.APPROVED, count: 10, ...NO_STATUS },
      ],
      // 8 tasks crossed over 4 weeks = 2 tasks/week; 10 remaining ⇒ 5 weeks.
      pace: [{ weekStart: '2026-08-10', count: 8 }],
      delivery: [{ weekStart: '2026-08-10', count: 400 }],
    });
    const view = await getOverview(7, 4, NOW);
    expect(view.projection).toEqual({
      unit: 'tasks',
      done: 10,
      total: 20,
      perWeek: 2,
      projectedEnd: '2026-09-22',
      unavailable: null,
    });
    // The output rate, enormous, does not touch the projection: that was the whole defect.
    expect(view.delivery.map((p) => p.count)).toEqual([0, 0, 400, 0]);
  });

  it('bounds the output rate to ready media and living parents', async () => {
    await getOverview(7, 8, NOW);
    const sql = vi
      .mocked(prisma.$queryRaw)
      .mock.calls.map((c) => (c[0] as unknown as TemplateStringsArray).join(' '))
      .find((s) => s.includes('MediaObject'))!;
    expect(sql).toContain(`m.status = 'READY'`);
    expect(sql.match(/sh\."deletedAt" IS NULL/)).not.toBeNull();
  });

  it('folds the matrix, the load and the pace from the counts of the database', async () => {
    stubQueryRaw({
      matrix: [
        { sequenceId: 1, department: 'comp', status: TaskStatus.TODO, count: 4, ...NO_STATUS },
        { sequenceId: 1, department: 'comp', status: TaskStatus.APPROVED, count: 6, ...NO_STATUS },
        { sequenceId: null, department: null, status: TaskStatus.IN_PROGRESS, count: 2, ...NO_STATUS },
      ],
      workload: [
        {
          assigneeId: 7,
          assigneeName: 'Ada',
          status: TaskStatus.IN_PROGRESS,
          count: 3,
          overdue: 1,
          ...NO_STATUS,
        },
      ],
      pace: [{ weekStart: '2026-08-10', count: 5 }],
    });
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([{ id: 1, code: 'SQ010' }] as never);

    const view = await getOverview(7, 4, NOW);

    expect(view.matrix).toEqual([
      { sequenceId: 1, department: 'comp', todo: 4, progress: 0, review: 0, done: 6, blocked: 0, total: 10 },
      {
        sequenceId: null,
        department: null,
        todo: 0,
        progress: 2,
        review: 0,
        done: 0,
        blocked: 0,
        total: 2,
      },
    ]);
    expect(view.departments).toEqual(['comp']);
    expect(view.workload).toEqual([
      { assigneeId: 7, name: 'Ada', todo: 0, progress: 3, review: 0, blocked: 0, overdue: 1, total: 3 },
    ]);
    expect(view.pace.map((p) => p.count)).toEqual([0, 0, 5, 0]);
    // 6 facts out of 12 counted (inactives are out of play), pace 5/4 weeks = 1.25.
    expect(view.projection).toMatchObject({ done: 6, total: 12, perWeek: 1.25 });
  });

  it('reads the studio reference: terminal counts as done, inactive does not count', async () => {
    stubQueryRaw({
      matrix: [
        // "fin": terminal on the site side, but the local enum says IN_PROGRESS.
        {
          sequenceId: 1,
          department: 'comp',
          status: TaskStatus.IN_PROGRESS,
          count: 3,
          isDone: true,
          isInactive: false,
          legacyStatus: TaskStatus.APPROVED,
        },
        // "omt": omitted — neither to do nor done.
        {
          sequenceId: 1,
          department: 'comp',
          status: TaskStatus.REJECTED,
          count: 5,
          isDone: false,
          isInactive: true,
          legacyStatus: TaskStatus.REJECTED,
        },
        {
          sequenceId: 1,
          department: 'comp',
          status: TaskStatus.TODO,
          count: 1,
          isDone: false,
          isInactive: false,
          legacyStatus: TaskStatus.TODO,
        },
      ],
    });
    const view = await getOverview(7, 8, NOW);
    expect(view.matrix[0]).toMatchObject({ done: 3, todo: 1, blocked: 0, total: 4 });
    expect(view.projection).toMatchObject({ done: 3, total: 4 });
    // The column remains visible even if its only remaining work has been set aside.
    expect(view.departments).toEqual(['comp']);
  });

  it('does not exclude terminal or inactive statuses from the attention lists', async () => {
    await getOverview(7, 8, NOW);
    const wheres = vi.mocked(prisma.task.findMany).mock.calls.map((c) => JSON.stringify(c[0]!.where));
    for (const where of wheres) {
      expect(where).toContain('"isDone":false');
      expect(where).toContain('"isInactive":false');
    }
  });

  it('re-splits the candidates without ever mixing the three lists', async () => {
    const row = (over: Record<string, unknown>) => ({
      id: 1,
      name: 't',
      status: TaskStatus.TODO,
      dueDate: null,
      department: 'comp',
      assignee: null,
      shot: { code: 'SH010', sequenceId: 1, sequence: { code: 'SQ010' } },
      asset: null,
      pipelineStatus: null,
      ...over,
    });
    vi.mocked(prisma.task.findMany)
      .mockResolvedValueOnce([row({ id: 1, dueDate: new Date('2026-08-01T00:00:00Z') })] as never)
      .mockResolvedValueOnce([row({ id: 1, dueDate: new Date('2026-08-01T00:00:00Z') })] as never)
      .mockResolvedValueOnce([
        row({ id: 2, status: TaskStatus.PENDING_REVIEW, assignee: { id: 7, name: 'Ada' } }),
      ] as never);

    const { attention } = await getOverview(7, 8, NOW);
    // Task 1 is both late and unassigned: a single row in the database, present in both lists.
    expect(attention.overdue.map((t) => t.id)).toEqual([1]);
    expect(attention.unassigned.map((t) => t.id)).toEqual([1]);
    expect(attention.waitingReview.map((t) => t.id)).toEqual([2]);
    expect(attention.overdue[0]).toMatchObject({ parentLabel: 'SH010', sequenceCode: 'SQ010' });
  });
});
