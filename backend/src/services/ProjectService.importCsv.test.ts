// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    sequence: { findMany: vi.fn() },
    shot: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/trash', () => ({
  softDeleteProject: vi.fn(),
  restoreProject: vi.fn(),
  purgeProject: vi.fn(),
}));
vi.mock('../lib/thumbnails', () => ({ effectiveThumbnailUrl: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));

import { importCsv } from './ProjectService';
import { prisma } from '../lib/prisma';

const admin = { id: 1, role: 'ADMIN' as const };
type ManyArgs = { data: Record<string, unknown>[] };

/**
 * Fake tx: grouped writes are captured, and `createManyAndReturn` returns the rows in reverse so that no
 * attachment can rely on the return order.
 */
function makeTx() {
  const created = {
    sequences: [] as Record<string, unknown>[],
    shots: [] as Record<string, unknown>[],
    tasks: [] as Record<string, unknown>[],
  };
  let seqId = 100;
  let shotId = 200;
  return {
    tx: {
      sequence: {
        createManyAndReturn: vi.fn((args: ManyArgs) => {
          const rows = args.data.map((d) => ({ ...d, id: ++seqId }));
          created.sequences.push(...rows);
          return Promise.resolve([...rows].reverse());
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      shot: {
        createManyAndReturn: vi.fn((args: ManyArgs) => {
          const rows = args.data.map((d) => ({ ...d, id: ++shotId }));
          created.shots.push(...rows);
          return Promise.resolve([...rows].reverse());
        }),
      },
      task: {
        createMany: vi.fn((args: ManyArgs) => {
          created.tasks.push(...args.data);
          return Promise.resolve({ count: args.data.length });
        }),
      },
    },
    created,
  };
}

const CSV = ['sequence,shot,name,tasks', 'SQ01,SH010,Ouverture,anim|comp', 'SQ01,SH020,Suite,anim'].join(
  '\n',
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.sequence.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.shot.findMany).mockResolvedValue([] as never);
});

describe('ProjectService.importCsv (38.F)', () => {
  it('in dry-run, writes nothing and returns the preview', async () => {
    const preview = await importCsv(admin, 3, CSV, false);
    expect(preview).toMatchObject({
      committed: false,
      sequencesToCreate: 1,
      shotsToCreate: 2,
      tasksToCreate: 3,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes sequences, shots and tasks in grouped writes (one call per entity)', async () => {
    const { tx, created } = makeTx();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: unknown) => unknown) =>
      fn(tx)) as never);

    await importCsv(admin, 3, CSV, true);

    expect(tx.sequence.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.shot.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.task.createMany).toHaveBeenCalledTimes(1);
    expect(created.sequences).toHaveLength(1);
    expect(created.shots).toHaveLength(2);
    expect(created.tasks).toHaveLength(3);
  });

  it('attaches each task to its shot, without relying on the return order', async () => {
    const { tx, created } = makeTx();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: unknown) => unknown) =>
      fn(tx)) as never);

    await importCsv(admin, 3, CSV, true);

    const sh010 = created.shots.find((s) => s.code === 'SH010')!.id;
    const sh020 = created.shots.find((s) => s.code === 'SH020')!.id;
    expect(created.tasks.filter((t) => t.shotId === sh010).map((t) => t.name)).toEqual(['anim', 'comp']);
    expect(created.tasks.filter((t) => t.shotId === sh020).map((t) => t.name)).toEqual(['anim']);
  });

  it('gives an explicit deadline to the transaction (the 5 s default does not hold a feature film)', async () => {
    const { tx } = makeTx();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: unknown) => unknown) =>
      fn(tx)) as never);

    await importCsv(admin, 3, CSV, true);

    const options = vi.mocked(prisma.$transaction).mock.calls[0]![1];
    expect(options?.timeout).toBeGreaterThan(5_000);
  });

  it('reuses a sequence already present instead of recreating it', async () => {
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([{ code: 'SQ01' }] as never);
    const { tx, created } = makeTx();
    tx.sequence.findMany.mockResolvedValue([{ id: 55, code: 'SQ01' }] as never);
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: unknown) => unknown) =>
      fn(tx)) as never);

    await importCsv(admin, 3, CSV, true);

    expect(created.sequences).toHaveLength(0);
    // A single query for all the reused sequences, not one per code.
    expect(tx.sequence.findMany).toHaveBeenCalledTimes(1);
    expect(created.shots.every((s) => s.sequenceId === 55)).toBe(true);
  });

  it('skips the shots already present without overwriting them', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue([{ code: 'SH010', sequenceId: 1 }] as never);
    const { tx, created } = makeTx();
    tx.sequence.findMany.mockResolvedValue([] as never);
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: unknown) => unknown) =>
      fn(tx)) as never);

    const result = await importCsv(admin, 3, CSV, true);

    expect(result).toMatchObject({ committed: true, shotsSkipped: 1, shotsToCreate: 1 });
    expect(created.shots.map((s) => s.code)).toEqual(['SH020']);
  });
});
