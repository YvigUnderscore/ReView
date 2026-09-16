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
};

/** Jeu de lignes distinctes, pour vérifier qu'on rend exactement ce qu'on a lu. */
const rows = (count: number): ScheduleRow[] =>
  Array.from({ length: count }, (_, i) => ({ ...base, id: i + 1, name: `task-${i + 1}` }));

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

describe('ScheduleService — toScheduleTask', () => {
  it('compose la localisation shot avec séquence et expose les dates ISO', () => {
    const t = toScheduleTask(base);
    expect(t.location).toBe('SQ010 · SH020');
    expect(t.sequenceId).toBe(3);
    expect(t.sequenceCode).toBe('SQ010');
    expect(t.dueDate).toBe('2026-07-20T00:00:00.000Z');
    expect(t.startDate).toBe('2026-07-13T00:00:00.000Z');
    expect(t.assignee).toEqual({ id: 9, name: 'Ada' });
  });

  it('gère un shot sans séquence', () => {
    const t = toScheduleTask({ ...base, shot: { code: 'SH999', sequence: null } });
    expect(t.location).toBe('SH999');
    expect(t.sequenceId).toBeNull();
  });

  it('utilise le nom d’asset et gère l’absence de dates/assigné', () => {
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

describe('ScheduleService — fenêtre de temps', () => {
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-12-01T00:00:00Z');

  it('sans borne, n’ajoute aucune clause — la lecture reste celle d’avant', () => {
    expect(scheduleWindowFilter({})).toEqual([]);
  });

  it('retient une tâche qui déborde la fenêtre des deux côtés (chevauchement, pas échéance)', () => {
    // Deux clauses : fin effective ≥ from, début effectif ≤ to. Une tâche commencée avant
    // la fenêtre et due après satisfait les deux — c'est le cas qu'un filtre sur la seule
    // échéance perdrait.
    expect(scheduleWindowFilter({ from, to })).toEqual([
      { OR: [{ dueDate: { gte: from } }, { dueDate: null, startDate: { gte: from } }] },
      { OR: [{ startDate: { lte: to } }, { startDate: null, dueDate: { lte: to } }] },
    ]);
  });

  it('tient la borne manquante par l’autre date', () => {
    expect(scheduleWindowFilter({ from })).toEqual([
      { OR: [{ dueDate: { gte: from } }, { dueDate: null, startDate: { gte: from } }] },
    ]);
    expect(scheduleWindowFilter({ to })).toEqual([
      { OR: [{ startDate: { lte: to } }, { startDate: null, dueDate: { lte: to } }] },
    ]);
  });

  it('passe la fenêtre au where, en plus des filtres de projet et de date', async () => {
    await getProjectSchedule(7, { from, to });
    const where = findMany.mock.calls[0]![0].where as { AND: unknown[] };
    expect(where.AND).toHaveLength(4);
    expect(where.AND.slice(2)).toEqual(scheduleWindowFilter({ from, to }));
  });
});

describe('ScheduleService — plafond de sécurité', () => {
  it('borne la lecture : jamais plus de SCHEDULE_MAX_TASKS + 1 lignes demandées', async () => {
    // La mesure du correctif : le nombre de lignes rapatriées. Sans `take`, la requête
    // ramenait tout le projet daté (huit mille lignes sur un long-métrage).
    await getProjectSchedule(7);
    expect(findMany.mock.calls[0]![0].take).toBe(SCHEDULE_MAX_TASKS + 1);
  });

  it('ferme le tri par id pour que la troncature soit reproductible', async () => {
    await getProjectSchedule(7);
    expect(findMany.mock.calls[0]![0].orderBy).toEqual([
      { dueDate: 'asc' },
      { startDate: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('au plafond exactement, rend tout et ne crie pas', async () => {
    findMany.mockResolvedValue(rows(SCHEDULE_MAX_TASKS));
    const out = await getProjectSchedule(7);
    expect(out.tasks).toHaveLength(SCHEDULE_MAX_TASKS);
    expect(out.truncated).toBe(false);
    expect(out.limit).toBe(SCHEDULE_MAX_TASKS);
  });

  it('au-delà, coupe au plafond et le dit', async () => {
    findMany.mockResolvedValue(rows(SCHEDULE_MAX_TASKS + 1));
    const out = await getProjectSchedule(7);
    expect(out.tasks).toHaveLength(SCHEDULE_MAX_TASKS);
    expect(out.truncated).toBe(true);
    // La ligne-sonde ne sert qu'à détecter le débordement : elle n'est pas servie.
    expect(out.tasks.at(-1)!.id).toBe(SCHEDULE_MAX_TASKS);
  });

  it('en deçà, rend exactement les lignes lues, dans l’ordre, telles que converties', async () => {
    const read = rows(3);
    findMany.mockResolvedValue(read);
    const out = await getProjectSchedule(7);
    expect(out.tasks).toEqual(read.map(toScheduleTask));
  });
});
