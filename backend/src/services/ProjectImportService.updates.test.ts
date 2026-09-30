// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * PERF-10 — coût des mises à jour de l'import CSV, mesuré en **nombre d'écritures** émises
 * dans la transaction. C'est la bonne unité : ce qui gêne n'est pas la durée de l'import
 * mais le temps pendant lequel il tient ses verrous, et ce temps est proportionnel au
 * nombre d'allers-retours avec PostgreSQL.
 */

const tx = {
  episode: { createManyAndReturn: vi.fn() },
  sequence: { createManyAndReturn: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  shot: { createManyAndReturn: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  task: { createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
};

vi.mock('../lib/prisma', () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    episode: { findMany: vi.fn() },
    sequence: { findMany: vi.fn() },
    shot: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./PipelineStatusService', () => ({ listForProject: vi.fn() }));
vi.mock('./DepartmentService', () => ({ listForProject: vi.fn() }));

import { prisma } from '../lib/prisma';
import * as DepartmentService from './DepartmentService';
import * as PipelineStatusService from './PipelineStatusService';
import { applyGroupedUpdates, commit } from './ProjectImportService';

type Reader = Mock<(args?: unknown) => Promise<unknown>>;
type TxRunner = Mock<(run: (client: typeof tx) => Promise<void>, options?: unknown) => Promise<void>>;

const mocked = prisma as unknown as {
  project: { findFirst: Reader };
  episode: { findMany: Reader };
  sequence: { findMany: Reader };
  shot: { findMany: Reader };
  task: { findMany: Reader };
  user: { findMany: Reader };
  $transaction: TxRunner;
};

const user = { id: 9, role: 'ADMIN' as const };

/** Jour ISO décalé de `offset` jours à partir du 1er septembre 2026. */
const day = (offset: number) => new Date(Date.UTC(2026, 8, 1 + offset)).toISOString().slice(0, 10);

interface ExistingShot {
  id: number;
  code: string;
  sequenceId: number;
  name: string;
  description: string | null;
  startFrame: number | null;
  endFrame: number | null;
  pipelineStatusId: number | null;
  order: number;
  deletedAt: Date | null;
}

/**
 * Projet déjà en base — `shots` plans, `tasksPerShot` tâches chacun — et le CSV de suivi
 * qui les réimporte en ne changeant qu'une échéance. `dueFor` décide si le fichier porte
 * la même date partout (balayage, cas fréquent) ou une par plan (replanification).
 */
function fixture(shots: number, tasksPerShot: number, dueFor: (i: number) => string) {
  const existingShots: ExistingShot[] = [];
  const existingTasks: Record<string, unknown>[] = [];
  const lines = ['sequence,shot,tasks,due_date'];
  let taskId = 1;
  for (let i = 0; i < shots; i++) {
    const code = `SH${String(i).padStart(4, '0')}`;
    existingShots.push({
      id: 1000 + i,
      code,
      sequenceId: 3,
      name: code,
      description: null,
      startFrame: null,
      endFrame: null,
      pipelineStatusId: null,
      order: i,
      deletedAt: null,
    });
    const names = Array.from({ length: tasksPerShot }, (_, j) => `T${j}`);
    for (const name of names) {
      existingTasks.push({
        id: taskId++,
        shotId: 1000 + i,
        name,
        department: null,
        departmentId: null,
        pipelineStatusId: null,
        assigneeId: null,
        startDate: null,
        dueDate: null,
      });
    }
    lines.push(`SQ010,${code},${names.join('|')},${dueFor(i)}`);
  }
  mocked.shot.findMany.mockResolvedValue(existingShots);
  mocked.task.findMany.mockResolvedValue(existingTasks);
  return { csv: lines.join('\n'), taskCount: existingTasks.length };
}

type ManyCall = { where: { id: { in: number[] } }; data: Record<string, unknown> };

/** Toutes les lignes visées par les `updateMany` d'une entité, dans l'ordre d'émission. */
const writtenIds = (calls: unknown[][]) => calls.flatMap((c) => (c[0] as ManyCall).where.id.in);

/**
 * Le groupement rendu ligne à ligne : `id → charge utile`. C'est la forme qu'écrivaient
 * les `update` unitaires, donc celle qu'il faut comparer pour prouver l'équivalence.
 */
function writtenPerRow(calls: unknown[][]): Map<number, unknown> {
  const out = new Map<number, unknown>();
  for (const call of calls) {
    const { where, data } = call[0] as ManyCall;
    for (const id of where.id.in) out.set(id, data);
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.project.findFirst.mockResolvedValue({ id: 1, startFrame: 1001, episodesEnabled: false });
  mocked.episode.findMany.mockResolvedValue([]);
  mocked.sequence.findMany.mockResolvedValue([{ id: 3, code: 'SQ010', episodeId: null, deletedAt: null }]);
  mocked.shot.findMany.mockResolvedValue([]);
  mocked.task.findMany.mockResolvedValue([]);
  mocked.user.findMany.mockResolvedValue([]);
  vi.mocked(PipelineStatusService.listForProject).mockResolvedValue([]);
  vi.mocked(DepartmentService.listForProject).mockResolvedValue([]);
  tx.episode.createManyAndReturn.mockResolvedValue([]);
  tx.sequence.createManyAndReturn.mockResolvedValue([]);
  tx.shot.createManyAndReturn.mockResolvedValue([]);
  tx.task.createMany.mockResolvedValue({ count: 0 });
  const matched = (args: { where: { id: { in: number[] } } }) =>
    Promise.resolve({ count: args.where.id.in.length });
  tx.sequence.updateMany.mockImplementation(matched);
  tx.shot.updateMany.mockImplementation(matched);
  tx.task.updateMany.mockImplementation(matched);
  mocked.$transaction.mockImplementation(async (fn: (c: typeof tx) => Promise<void>) => fn(tx));
});

describe('import CSV — coût des mises à jour', () => {
  it('replanification (400 plans, 2 000 tâches, une échéance par plan) : 2 000 écritures → 400', async () => {
    const { csv, taskCount } = fixture(400, 5, (i) => day(i));
    const report = await commit(user, 1, csv);

    expect(taskCount).toBe(2000);
    expect(report.counts.tasksToUpdate).toBe(2000); // 2 000 `tx.task.update` avant le correctif
    expect(tx.task.update).not.toHaveBeenCalled();
    // Une écriture par échéance distincte : les cinq tâches d'un plan partagent la leur.
    expect(tx.task.updateMany).toHaveBeenCalledTimes(400);
    // Et exactement les mêmes lignes qu'avant, ni plus ni moins.
    expect(writtenIds(tx.task.updateMany.mock.calls)).toHaveLength(2000);
    expect(new Set(writtenIds(tx.task.updateMany.mock.calls)).size).toBe(2000);

    // Équivalence de sortie, déduite du fichier et non de l'implémentation : la tâche
    // numéro `id` appartient au plan `(id - 1) / 5`, dont le CSV porte l'échéance.
    const written = writtenPerRow(tx.task.updateMany.mock.calls);
    const expected = new Map(
      Array.from({ length: 2000 }, (_, i) => [
        i + 1,
        { dueDate: new Date(`${day(Math.floor(i / 5))}T00:00:00.000Z`) },
      ]),
    );
    expect(written).toEqual(expected);
  });

  it('balayage homogène (même échéance partout) : 2 000 écritures → 4 lots de 500', async () => {
    const { csv } = fixture(400, 5, () => day(0));
    await commit(user, 1, csv);
    expect(tx.task.updateMany).toHaveBeenCalledTimes(4);
    expect(writtenIds(tx.task.updateMany.mock.calls)).toHaveLength(2000);
  });

  it('écrit la date à minuit UTC, une seule fois pour tout le groupe', async () => {
    const { csv } = fixture(3, 2, () => '15/09/2026');
    await commit(user, 1, csv);
    expect(tx.task.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2, 3, 4, 5, 6] } },
      data: { dueDate: new Date('2026-09-15T00:00:00.000Z') },
    });
  });

  it('regroupe aussi les plans : un seul updateMany pour un renommage commun', async () => {
    fixture(3, 1, () => day(0));
    const lines = ['sequence,shot,name'];
    for (let i = 0; i < 3; i++) lines.push(`SQ010,SH${String(i).padStart(4, '0')},Rooftop`);
    await commit(user, 1, lines.join('\n'));
    expect(tx.shot.update).not.toHaveBeenCalled();
    expect(tx.shot.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.shot.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1000, 1001, 1002] } },
      data: { name: 'Rooftop' },
    });
  });

  it('regroupe le rattachement des séquences à un épisode', async () => {
    mocked.project.findFirst.mockResolvedValue({ id: 1, startFrame: 1001, episodesEnabled: true });
    mocked.episode.findMany.mockResolvedValue([{ id: 20, code: 'EP01', deletedAt: null }]);
    mocked.sequence.findMany.mockResolvedValue([
      { id: 3, code: 'SQ010', episodeId: null, deletedAt: null },
      { id: 4, code: 'SQ020', episodeId: null, deletedAt: null },
    ]);
    tx.shot.createManyAndReturn.mockResolvedValue([]);

    await commit(user, 1, 'episode,sequence,shot\nEP01,SQ010,SH0010\nEP01,SQ020,SH0020');

    expect(tx.sequence.update).not.toHaveBeenCalled();
    expect(tx.sequence.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.sequence.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [3, 4] } },
      data: { episodeId: 20 },
    });
  });

  it('une ligne disparue entre le plan et l’écriture fait avorter l’import', async () => {
    const { csv } = fixture(3, 1, () => day(0));
    tx.task.updateMany.mockResolvedValue({ count: 2 }); // une des trois lignes n'existe plus
    await expect(commit(user, 1, csv)).rejects.toMatchObject({ code: 'IMPORT_RACE', statusCode: 409 });
  });
});

describe('applyGroupedUpdates', () => {
  const write = (seen: { ids: number[]; data: unknown }[]) => (ids: number[], data: unknown) => {
    seen.push({ ids, data });
    return Promise.resolve({ count: ids.length });
  };

  it('ne fait rien sans mise à jour', async () => {
    const seen: { ids: number[]; data: unknown }[] = [];
    await applyGroupedUpdates([], write(seen), 'Task');
    expect(seen).toEqual([]);
  });

  it('regroupe quel que soit l’ordre des clés de la charge utile', async () => {
    const seen: { ids: number[]; data: unknown }[] = [];
    await applyGroupedUpdates(
      [
        { id: 1, data: { name: 'a', order: 2 } },
        { id: 2, data: { order: 2, name: 'a' } },
      ],
      write(seen),
      'Shot',
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]!.ids).toEqual([1, 2]);
  });

  it('referme le lot quand un identifiant revient, pour que la dernière écriture l’emporte', async () => {
    const seen: { ids: number[]; data: unknown }[] = [];
    await applyGroupedUpdates(
      [
        { id: 1, data: { name: 'a' } },
        { id: 2, data: { name: 'b' } },
        { id: 1, data: { name: 'c' } },
      ],
      write(seen),
      'Shot',
    );
    // Les deux premières partent ensemble, la reprise sur l'id 1 vient après : l'ordre
    // qui décide de la valeur finale est conservé.
    expect(seen.map((s) => s.ids)).toEqual([[1], [2], [1]]);
    expect(seen.at(-1)!.data).toEqual({ name: 'c' });
  });

  it('découpe un groupe au-delà de 500 identifiants', async () => {
    const seen: { ids: number[]; data: unknown }[] = [];
    const updates = Array.from({ length: 1200 }, (_, i) => ({ id: i + 1, data: { name: 'a' } }));
    await applyGroupedUpdates(updates, write(seen), 'Shot');
    expect(seen.map((s) => s.ids.length)).toEqual([500, 500, 200]);
  });
});
