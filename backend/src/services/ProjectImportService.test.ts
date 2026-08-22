// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

const tx = {
  episode: { createManyAndReturn: vi.fn() },
  sequence: { createManyAndReturn: vi.fn(), update: vi.fn() },
  shot: { createManyAndReturn: vi.fn(), update: vi.fn() },
  task: { createMany: vi.fn(), update: vi.fn() },
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
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./PipelineStatusService', () => ({ listForProject: vi.fn() }));
vi.mock('./DepartmentService', () => ({ listForProject: vi.fn() }));

import { prisma } from '../lib/prisma';
import { parseProjectCsv } from '../lib/projectCsvParse';
import * as DepartmentService from './DepartmentService';
import * as PipelineStatusService from './PipelineStatusService';
import { commit, preview, template } from './ProjectImportService';

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

beforeEach(() => {
  vi.clearAllMocks();
  mocked.project.findFirst.mockResolvedValue({ id: 1, startFrame: 1001, episodesEnabled: false });
  mocked.episode.findMany.mockResolvedValue([]);
  mocked.sequence.findMany.mockResolvedValue([]);
  mocked.shot.findMany.mockResolvedValue([]);
  mocked.task.findMany.mockResolvedValue([]);
  mocked.user.findMany.mockResolvedValue([
    { id: 40, email: 'mia@studio.tld', name: 'Mia Okafor', username: 'mia', firstName: null, lastName: null },
  ]);
  vi.mocked(PipelineStatusService.listForProject).mockResolvedValue([]);
  vi.mocked(DepartmentService.listForProject).mockResolvedValue([]);
  tx.episode.createManyAndReturn.mockResolvedValue([]);
  tx.sequence.createManyAndReturn.mockResolvedValue([]);
  tx.shot.createManyAndReturn.mockResolvedValue([]);
  tx.task.createMany.mockResolvedValue({ count: 0 });
  mocked.$transaction.mockImplementation(async (fn: (c: typeof tx) => Promise<void>) => fn(tx));
});

describe('template', () => {
  it('se relit par l’import : le gabarit est un fichier valide', () => {
    const parse = parseProjectCsv(template());
    expect(parse.issues).toEqual([]);
    expect(parse.entries.map((e) => e.shot)).toEqual(['SH0010', 'SH0020']);
    expect(parse.entries[0]).toMatchObject({ episode: 'EP01', sequence: 'SQ010', startFrame: 1001 });
    expect(parse.entries[0]!.tasks[0]).toMatchObject({ name: 'Anim', department: 'ANIMATION' });
  });
});

describe('preview', () => {
  it('n’écrit rien et rend le plan', async () => {
    const report = await preview(1, 'sequence,shot,tasks\nSQ010,SH0010,Anim');
    expect(report.committed).toBe(false);
    expect(mocked.$transaction).not.toHaveBeenCalled();
    expect(report.counts).toMatchObject({ sequencesToCreate: 1, shotsToCreate: 1, tasksToCreate: 1 });
    expect(report.columns.map((c) => c.field)).toEqual(['sequence', 'shot', 'task']);
  });

  it('borne le rapport et le signale', async () => {
    const lines = ['shot'];
    for (let i = 0; i < 1200; i++) lines.push(`SH${String(i).padStart(4, '0')}`);
    const report = await preview(1, lines.join('\n'));
    expect(report.counts.shotsToCreate).toBe(1200);
    expect(report.rows).toHaveLength(1000);
    expect(report.truncated).toBe(true);
  });
});

describe('commit', () => {
  const user = { id: 9, role: 'ADMIN' as const };

  it('écrit par lots dans une transaction bornée', async () => {
    tx.sequence.createManyAndReturn.mockResolvedValue([{ id: 3, code: 'SQ010' }]);
    tx.shot.createManyAndReturn.mockResolvedValue([{ id: 8, code: 'SH0010', sequenceId: 3 }]);

    const report = await commit(user, 1, 'sequence,shot,tasks\nSQ010,SH0010,Anim');

    expect(report.committed).toBe(true);
    expect(mocked.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 120_000,
      maxWait: 15_000,
    });
    expect(tx.sequence.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.shot.createManyAndReturn).toHaveBeenCalledTimes(1);
    // La tâche est rattachée au plan tout juste créé, par son couple (séquence, code).
    expect(tx.task.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ shotId: 8, name: 'Anim' })],
    });
  });

  it('découpe les écritures groupées au-delà de la taille de lot', async () => {
    const lines = ['shot'];
    for (let i = 0; i < 1100; i++) lines.push(`SH${String(i).padStart(4, '0')}`);
    await commit(user, 1, lines.join('\n'));
    expect(tx.shot.createManyAndReturn).toHaveBeenCalledTimes(3);
  });

  it('ne réécrit rien quand le fichier est rejoué', async () => {
    mocked.sequence.findMany.mockResolvedValue([{ id: 3, code: 'SQ010', episodeId: null, deletedAt: null }]);
    mocked.shot.findMany.mockResolvedValue([
      {
        id: 8,
        code: 'SH0010',
        sequenceId: 3,
        name: 'SH0010',
        description: null,
        startFrame: null,
        endFrame: null,
        pipelineStatusId: null,
        order: 0,
        deletedAt: null,
      },
    ]);
    mocked.task.findMany.mockResolvedValue([
      {
        id: 11,
        shotId: 8,
        name: 'Anim',
        department: null,
        departmentId: null,
        pipelineStatusId: null,
        assigneeId: null,
        startDate: null,
        dueDate: null,
      },
    ]);

    const report = await commit(user, 1, 'sequence,shot,tasks\nSQ010,SH0010,Anim');

    expect(report.counts).toMatchObject({ shotsUnchanged: 1, tasksUnchanged: 1, shotsToCreate: 0 });
    expect(tx.shot.createManyAndReturn).not.toHaveBeenCalled();
    expect(tx.shot.update).not.toHaveBeenCalled();
    expect(tx.task.update).not.toHaveBeenCalled();
    expect(tx.task.createMany).not.toHaveBeenCalled();
  });

  it('écrit les dates de tâche à minuit UTC', async () => {
    tx.shot.createManyAndReturn.mockResolvedValue([{ id: 8, code: 'SH0010', sequenceId: null }]);
    await commit(user, 1, 'shot,tasks,due_date\nSH0010,Anim,15/09/2026');
    expect(tx.task.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ dueDate: new Date('2026-09-15T00:00:00.000Z') })],
    });
  });
});
