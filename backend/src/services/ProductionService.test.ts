// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { $queryRaw: vi.fn(), sequence: { findMany: vi.fn() }, task: { findMany: vi.fn() } },
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

const NOW = new Date('2026-08-18T12:00:00Z'); // un mardi

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
  it('croise séquence et département, et compte par famille', () => {
    const cells = buildMatrix([
      task({ id: 1, status: TaskStatus.TODO }),
      task({ id: 2, status: TaskStatus.APPROVED }),
      task({ id: 3, status: TaskStatus.RETAKE, department: 'anim' }),
    ]);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({ sequenceId: 1, department: 'comp', todo: 1, done: 1, total: 2 });
    expect(cells[1]).toMatchObject({ department: 'anim', blocked: 1, total: 1 });
  });

  it('range ensemble ce qui n’a ni séquence ni département', () => {
    const cells = buildMatrix([
      task({ id: 1, sequenceId: null, department: null }),
      task({ id: 2, sequenceId: null, department: null, status: TaskStatus.IN_PROGRESS }),
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ sequenceId: null, department: null, todo: 1, progress: 1 });
  });

  it('additionne les lignes déjà comptées en base, une case identique à N tâches', () => {
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

  it('sort des jauges les statuts inactifs — ni à faire, ni fait', () => {
    const cells = buildMatrix([
      { sequenceId: 1, department: 'comp', status: TaskStatus.TODO, count: 4 },
      { sequenceId: 1, department: 'comp', status: TaskStatus.TODO, family: 'inactive', count: 6 },
    ]);
    expect(cells[0]).toMatchObject({ todo: 4, total: 4 });
  });

  it('compte comme fait le statut que le studio déclare terminal', () => {
    // « fin » côté ShotGrid : l'enum local dit encore IN_PROGRESS.
    const cells = buildMatrix([
      { sequenceId: 1, department: 'comp', status: TaskStatus.IN_PROGRESS, family: 'done', count: 2 },
    ]);
    expect(cells[0]).toMatchObject({ done: 2, progress: 0, total: 2 });
  });
});

describe('findAttention', () => {
  const yesterday = new Date('2026-08-17T12:00:00Z');
  const tomorrow = new Date('2026-08-19T12:00:00Z');

  it('signale les échéances dépassées, la plus ancienne d’abord', () => {
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

  it('ne compte jamais une tâche terminée comme en retard', () => {
    // Sa date est passée, mais le travail est fait : la signaler noierait ce qui compte.
    const found = findAttention([task({ id: 1, status: TaskStatus.APPROVED, dueDate: yesterday })], NOW);
    expect(found.overdue).toEqual([]);
    expect(found.unassigned).toEqual([]);
  });

  it('écarte de même une tâche inactive, omise ou sans objet', () => {
    const found = findAttention(
      [task({ id: 1, status: TaskStatus.TODO, family: 'inactive', dueDate: yesterday })],
      NOW,
    );
    expect(found.overdue).toEqual([]);
    expect(found.unassigned).toEqual([]);
  });

  it('sépare les non-assignés et l’attente de review', () => {
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

  it('reconnaît l’attente de verdict d’un statut personnalisé', () => {
    // Statut « suprev » du site : l'enum local n'en sait rien, la famille si.
    const found = findAttention(
      [task({ id: 4, assigneeId: 7, status: TaskStatus.IN_PROGRESS, family: 'review' })],
      NOW,
    );
    expect(found.waitingReview.map((t) => t.id)).toEqual([4]);
  });

  it('borne chaque liste, une page ne se lit pas à cinq cents lignes', () => {
    const many = Array.from({ length: 80 }, (_, i) => task({ id: i, assigneeId: null }));
    expect(findAttention(many, NOW, 10).unassigned).toHaveLength(10);
  });
});

describe('buildWorkload', () => {
  it('compte ce qui reste à faire, par personne', () => {
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

  it('exclut le travail terminé — la charge, c’est ce qui reste', () => {
    expect(buildWorkload([task({ assigneeId: 7, status: TaskStatus.APPROVED })], NOW)).toEqual([]);
    expect(
      buildWorkload([task({ assigneeId: 7, status: TaskStatus.TODO, family: 'inactive' })], NOW),
    ).toEqual([]);
  });

  it('compte les retards de chacun', () => {
    const late = new Date('2026-08-01T12:00:00Z');
    const rows = buildWorkload([task({ assigneeId: 7, assigneeName: 'Ada', dueDate: late })], NOW);
    expect(rows[0]?.overdue).toBe(1);
  });

  it('reprend les retards déjà comptés en base plutôt que de relire des dates', () => {
    const rows = buildWorkload(
      [
        { assigneeId: 7, assigneeName: 'Ada', status: TaskStatus.TODO, count: 9, overdue: 4 },
        { assigneeId: 7, assigneeName: 'Ada', status: TaskStatus.PENDING_REVIEW, count: 1, overdue: 0 },
      ],
      NOW,
    );
    expect(rows[0]).toMatchObject({ todo: 9, review: 1, total: 10, overdue: 4 });
  });

  it('range les non-assignées en dernier, si nombreuses soient-elles', () => {
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
  it('ramène au lundi, y compris depuis un dimanche', () => {
    expect(weekStartOf(new Date('2026-08-18T12:00:00Z')).toISOString()).toBe('2026-08-17T00:00:00.000Z');
    expect(weekStartOf(new Date('2026-08-23T23:00:00Z')).toISOString()).toBe('2026-08-17T00:00:00.000Z');
    expect(weekStartOf(new Date('2026-08-17T00:00:00Z')).toISOString()).toBe('2026-08-17T00:00:00.000Z');
  });
});

describe('buildPace', () => {
  it('rend une semaine par créneau, les vides comprises', () => {
    const points = buildPace([], NOW, 4);
    expect(points.map((p) => p.weekStart)).toEqual(['2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17']);
    expect(points.every((p) => p.delivered === 0)).toBe(true);
  });

  it('range chaque livraison dans sa semaine', () => {
    // Les mêmes trois livraisons qu'avant, déjà regroupées par la base : deux dans la
    // semaine du 17 (mardi 18 et lundi 17), une dans celle du 10.
    const points = buildPace(
      [
        { weekStart: '2026-08-17', delivered: 2 },
        { weekStart: '2026-08-10', delivered: 1 },
      ],
      NOW,
      4,
    );
    expect(points.map((p) => p.delivered)).toEqual([0, 0, 1, 2]);
  });

  it('ignore ce qui tombe hors fenêtre plutôt que de le rattacher au bord', () => {
    expect(
      buildPace([{ weekStart: '2025-12-29', delivered: 1 }], NOW, 4).every((p) => p.delivered === 0),
    ).toBe(true);
  });
});

describe('projectEnd', () => {
  const points = [
    { weekStart: '2026-08-03', delivered: 4 },
    { weekStart: '2026-08-10', delivered: 6 },
  ];

  it('projette la fin au rythme observé', () => {
    const p = projectEnd(10, 30, points, NOW);
    expect(p.perWeek).toBe(5);
    // 20 restantes à 5/semaine = 4 semaines.
    expect(p.projectedEnd).toBe('2026-09-15');
  });

  it('ne projette rien sans rythme — une date inventée se lirait comme un engagement', () => {
    expect(projectEnd(10, 30, [{ weekStart: '2026-08-10', delivered: 0 }], NOW).projectedEnd).toBeNull();
    expect(projectEnd(10, 30, [], NOW).projectedEnd).toBeNull();
  });

  it('ne projette rien quand tout est fait', () => {
    expect(projectEnd(30, 30, points, NOW).projectedEnd).toBeNull();
  });
});

// ── Assemblage : ce que getOverview demande à la base, et ce qu'il en fait ────

const NO_STATUS = { isDone: null, isInactive: null, legacyStatus: null };

/** Renvoie la réponse correspondant au SQL reconnu dans le template balisé. */
function stubQueryRaw(answers: { matrix?: unknown[]; workload?: unknown[]; pace?: unknown[] }) {
  vi.mocked(prisma.$queryRaw).mockImplementation(((strings: TemplateStringsArray) => {
    const sql = strings.join(' ');
    if (sql.includes('date_trunc')) return Promise.resolve(answers.pace ?? []);
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
  });

  it('ne lit que des agrégats : trois requêtes brutes, les séquences, trois listes bornées', async () => {
    await getOverview(7, 8, NOW);
    expect(vi.mocked(prisma.$queryRaw)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(prisma.sequence.findMany)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.task.findMany)).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(prisma.task.findMany).mock.calls) {
      expect(call[0]!.take).toBe(50);
    }
  });

  it('replie la matrice, la charge et le rythme depuis les comptes de la base', async () => {
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
      pace: [{ weekStart: '2026-08-10', delivered: 5 }],
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
    expect(view.pace.map((p) => p.delivered)).toEqual([0, 0, 5, 0]);
    // 6 faits sur 12 comptés (les inactifs sont hors jeu), rythme 5/4 semaines = 1,25.
    expect(view.projection).toMatchObject({ done: 6, total: 12, perWeek: 1.25 });
  });

  it('lit le référentiel du studio : terminal compte comme fait, inactif ne compte pas', async () => {
    stubQueryRaw({
      matrix: [
        // « fin » : terminal côté site, mais l'enum local dit IN_PROGRESS.
        {
          sequenceId: 1,
          department: 'comp',
          status: TaskStatus.IN_PROGRESS,
          count: 3,
          isDone: true,
          isInactive: false,
          legacyStatus: TaskStatus.APPROVED,
        },
        // « omt » : omis — ni à faire, ni fait.
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
    // La colonne reste visible même si son seul reste-à-faire a été mis de côté.
    expect(view.departments).toEqual(['comp']);
  });

  it('n’écarte des listes d’attention ni les statuts terminaux ni les inactifs', async () => {
    await getOverview(7, 8, NOW);
    const wheres = vi.mocked(prisma.task.findMany).mock.calls.map((c) => JSON.stringify(c[0]!.where));
    for (const where of wheres) {
      expect(where).toContain('"isDone":false');
      expect(where).toContain('"isInactive":false');
    }
  });

  it('repartage les candidats sans jamais mélanger les trois listes', async () => {
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
    // La tâche 1 est à la fois en retard et non assignée : une seule ligne en base,
    // présente dans les deux listes.
    expect(attention.overdue.map((t) => t.id)).toEqual([1]);
    expect(attention.unassigned.map((t) => t.id)).toEqual([1]);
    expect(attention.waitingReview.map((t) => t.id)).toEqual([2]);
    expect(attention.overdue[0]).toMatchObject({ parentLabel: 'SH010', sequenceCode: 'SQ010' });
  });
});
