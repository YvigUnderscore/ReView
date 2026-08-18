// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  buildMatrix,
  buildPace,
  buildWorkload,
  findAttention,
  projectEnd,
  weekStartOf,
  type ProductionTask,
} from './ProductionService';
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
  });

  it('compte les retards de chacun', () => {
    const late = new Date('2026-08-01T12:00:00Z');
    const rows = buildWorkload([task({ assigneeId: 7, assigneeName: 'Ada', dueDate: late })], NOW);
    expect(rows[0]?.overdue).toBe(1);
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
    const points = buildPace(
      [new Date('2026-08-18T09:00:00Z'), new Date('2026-08-17T00:30:00Z'), new Date('2026-08-11T09:00:00Z')],
      NOW,
      4,
    );
    expect(points.map((p) => p.delivered)).toEqual([0, 0, 1, 2]);
  });

  it('ignore ce qui tombe hors fenêtre plutôt que de le rattacher au bord', () => {
    expect(buildPace([new Date('2026-01-01T09:00:00Z')], NOW, 4).every((p) => p.delivered === 0)).toBe(true);
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
