// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { ProductionOverview, ProductionTask } from '../../types/production';
import type { ProjectStats, ShotStat } from '../../types/api';
import {
  distinctBlocking,
  familyOfTask,
  rankRetakes,
  readAttention,
  readPace,
  readRetakes,
} from './productionWire';

/**
 * Ce que ces tests verrouillent, ce sont les trois nombres que l'utilisateur a lus de
 * travers à l'écran : un « 50 » qui était un plafond, un badge qui comptait deux fois la
 * même tâche, et une projection née d'une division entre deux unités différentes.
 */

const task = (id: number, over: Partial<ProductionTask> = {}): ProductionTask => ({
  id,
  name: `T${id}`,
  status: 'TODO',
  dueDate: null,
  assigneeId: null,
  assigneeName: null,
  department: 'comp',
  sequenceId: 1,
  sequenceCode: 'SQ01',
  parentLabel: 'SH010',
  ...over,
});

const overview = (over: Record<string, unknown>): ProductionOverview => ({
  matrix: [],
  sequences: [],
  departments: [],
  attention: { overdue: [], unassigned: [], waitingReview: [] },
  workload: [],
  pace: [],
  projection: { done: 0, total: 0, perWeek: 0, projectedEnd: null },
  ...over,
});

describe('readAttention', () => {
  it('rend les totaux du serveur, pas la longueur des listes plafonnées', () => {
    const reading = readAttention(
      overview({
        attention: {
          overdue: [task(1), task(2)],
          unassigned: [task(2)],
          waitingReview: [],
          totals: { overdue: 312, unassigned: 40, waitingReview: 7, blocking: 330 },
          limit: 50,
        },
      }),
    );
    expect(reading.overdue).toBe(312);
    expect(reading.blocking).toBe(330);
    expect(reading.limit).toBe(50);
    expect(reading.capped).toBe(true);
  });

  it('ne compte qu’une fois une tâche à la fois en retard et non assignée', () => {
    const shared = task(7);
    expect(distinctBlocking({ overdue: [shared], unassigned: [shared], waitingReview: [] })).toBe(1);
  });

  it('retombe sur l’union dédoublonnée quand le serveur ne rend pas de totaux', () => {
    const shared = task(7);
    const reading = readAttention(
      overview({ attention: { overdue: [shared, task(8)], unassigned: [shared], waitingReview: [task(9)] } }),
    );
    expect(reading.overdue).toBe(2);
    // 5 + 9 + 6 était la somme ; ici 2 + 1 + 1 = 4 alors que seules trois tâches existent.
    expect(reading.blocking).toBe(3);
    expect(reading.capped).toBe(false);
    expect(reading.limit).toBeNull();
  });
});

describe('readPace', () => {
  const base = {
    pace: [{ weekStart: '2026-09-07', count: 4 }],
    delivery: [{ weekStart: '2026-09-07', count: 11 }],
  };

  it('trace le débit de sortie et nomme son unité quand le serveur la sépare', () => {
    const reading = readPace(
      overview({
        ...base,
        projection: {
          unit: 'tasks',
          done: 40,
          total: 100,
          perWeek: 4,
          projectedEnd: '2027-01-04',
          unavailable: null,
        },
      }),
    );
    expect(reading.series).toEqual([{ weekStart: '2026-09-07', count: 11 }]);
    expect(reading.unit).toBe('media');
    expect(reading.perWeekUnit).toBe('tasks');
    expect(reading.percent).toBe(40);
    expect(reading.projectedEnd).toBe('2027-01-04');
    expect(reading.unavailable).toBeNull();
  });

  it('reprend la raison d’indisponibilité du serveur et refuse alors toute date', () => {
    const reading = readPace(
      overview({
        ...base,
        projection: {
          unit: 'tasks',
          done: 40,
          total: 100,
          perWeek: 0,
          projectedEnd: '2028-12-14',
          unavailable: 'no-velocity',
        },
      }),
    );
    expect(reading.unavailable).toBe('no-velocity');
    expect(reading.projectedEnd).toBeNull();
  });

  it('déduit la raison quand le serveur est encore l’ancien, sans nommer d’unité', () => {
    const done = readPace(
      overview({
        pace: [{ weekStart: '2026-09-07', delivered: 3 }],
        projection: { done: 12, total: 12, perWeek: 3, projectedEnd: null },
      }),
    );
    expect(done.unavailable).toBe('nothing-left');
    expect(done.series).toEqual([{ weekStart: '2026-09-07', count: 3 }]);
    expect(done.unit).toBeNull();
    expect(done.perWeekUnit).toBeNull();

    const idle = readPace(overview({ projection: { done: 1, total: 12, perWeek: 0, projectedEnd: null } }));
    expect(idle.unavailable).toBe('no-velocity');

    const empty = readPace(overview({ projection: { done: 0, total: 0, perWeek: 0, projectedEnd: null } }));
    expect(empty.unavailable).toBe('nothing-counted');
    expect(empty.percent).toBe(0);
  });
});

describe('familyOfTask', () => {
  it('suit la famille du serveur quand elle est là', () => {
    expect(familyOfTask({ status: 'TODO', family: 'done' } as never)).toBe('done');
  });

  it('retombe sur l’enum, avec les mêmes familles que le serveur', () => {
    expect(familyOfTask({ status: 'RETAKE' } as never)).toBe('blocked');
    expect(familyOfTask({ status: 'APPROVED' } as never)).toBe('done');
    expect(familyOfTask({ status: 'PENDING_REVIEW' } as never)).toBe('review');
    expect(familyOfTask({ status: 'IN_PROGRESS' } as never)).toBe('progress');
    expect(familyOfTask({ status: 'TODO' } as never)).toBe('todo');
  });
});

describe('readRetakes', () => {
  const shot = (over: Partial<ShotStat> & { reviewRounds?: number }): ShotStat => ({
    shotId: 1,
    code: 'SH010',
    name: 'Chase',
    sequenceId: 1,
    versions: 3,
    retakes: 0,
    openNotes: 0,
    reviewDays: null,
    status: 'inReview',
    ...over,
  });

  const stats = (over: Record<string, unknown>): ProjectStats => ({
    totals: {
      shots: 10,
      versions: 30,
      decisions: 12,
      approvalRate: 40,
      openNotes: 5,
      avgReviewDays: 6.5,
      avgRetakesPerShot: 1.4,
      avgNotesPerVersion: 0.8,
    },
    sequences: [],
    slowestShots: [],
    ...over,
  });

  it('classe les plans les plus repris, pire d’abord, et écarte ceux sans retake', () => {
    const rows = rankRetakes([
      shot({ shotId: 1, code: 'SH010', retakes: 1 }),
      shot({ shotId: 2, code: 'SH020', retakes: 5, reviewRounds: 7 }),
      shot({ shotId: 3, code: 'SH030', retakes: 0 }),
      shot({ shotId: 4, code: 'SH040', retakes: 5, openNotes: 3 }),
    ]);
    expect(rows.map((r) => r.code)).toEqual(['SH040', 'SH020', 'SH010']);
    expect(rows[1].reviewRounds).toBe(7);
    expect(rows[0].reviewRounds).toBeNull();
  });

  it('borne la liste', () => {
    const many = Array.from({ length: 20 }, (_, i) => shot({ shotId: i, code: `SH${i}`, retakes: 2 }));
    expect(rankRetakes(many, 3)).toHaveLength(3);
  });

  it('lit le classement dédié du serveur quand il existe', () => {
    const reading = readRetakes(
      stats({
        mostRetakenShots: [shot({ shotId: 9, code: 'SH090', retakes: 4, reviewRounds: 6 })],
        retakeBuckets: [{ min: 0, max: 0, shots: 3 }],
        totals: {
          shots: 10,
          versions: 30,
          decisions: 12,
          approvalRate: 40,
          openNotes: 5,
          avgReviewDays: 6.5,
          avgRetakesPerShot: 1.4,
          avgReviewRoundsPerShot: 2.1,
          avgNotesPerVersion: 0.8,
          firstTimeRightRate: 62,
        },
      }),
    );
    expect(reading.worst.map((r) => r.code)).toEqual(['SH090']);
    expect(reading.avgReviewRounds).toBe(2.1);
    expect(reading.firstTimeRightRate).toBe(62);
    expect(reading.buckets).toHaveLength(1);
  });

  it('retombe sur les plans les plus lents quand le serveur est encore l’ancien', () => {
    const reading = readRetakes(stats({ slowestShots: [shot({ shotId: 5, code: 'SH050', retakes: 2 })] }));
    expect(reading.worst.map((r) => r.code)).toEqual(['SH050']);
    expect(reading.avgReviewRounds).toBeNull();
    expect(reading.firstTimeRightRate).toBeNull();
    expect(reading.avgRetakes).toBe(1.4);
    expect(reading.buckets).toEqual([]);
  });
});
