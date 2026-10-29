// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    project: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
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

import { duplicateProject } from './ProjectService';
import { prisma } from '../lib/prisma';
import { TaskType } from '@prisma/client';

const findFirst = vi.mocked(prisma.project.findFirst);
const findUnique = vi.mocked(prisma.project.findUnique);
const admin = { id: 1, role: 'ADMIN' as const };

// Minimal shapes of the captured creations: the service only reads id + copied columns.
type Row = { id: number } & Record<string, unknown>;
type CreateManyArgs = { data: Record<string, unknown>[] };

/**
 * Fake tx: sequential ids per entity, capture of grouped writes. `createManyAndReturn` deliberately returns
 * rows OUT OF ORDER — the service must only hold on to `(sequenceId, code)`, never to the return order.
 */
function makeTx() {
  const created = { sequences: [] as Row[], shots: [] as Row[], tasks: [] as Record<string, unknown>[] };
  let seqId = 100;
  let shotId = 200;
  const createMany = (bucket: Row[], nextId: () => number) =>
    vi.fn((args: CreateManyArgs) => {
      const rows = args.data.map((data) => ({ ...data, id: nextId() }));
      bucket.push(...rows);
      return Promise.resolve([...rows].reverse());
    });
  return {
    tx: {
      project: { create: vi.fn().mockResolvedValue({ id: 42 }) },
      sequence: { createManyAndReturn: createMany(created.sequences, () => ++seqId) },
      shot: { createManyAndReturn: createMany(created.shots, () => ++shotId) },
      task: {
        createMany: vi.fn((args: CreateManyArgs) => {
          created.tasks.push(...args.data);
          return Promise.resolve({ count: args.data.length });
        }),
      },
    },
    created,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('ProjectService.duplicateProject (38.A)', () => {
  it('404 if the source project is not found', async () => {
    findFirst.mockResolvedValue(null);
    await expect(duplicateProject(admin, 5, 'Copie', false)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('400 SLUG_TAKEN if a project already carries this name', async () => {
    findFirst.mockResolvedValue({ studioId: 1, sequences: [], shots: [], settings: {} } as never);
    findUnique.mockResolvedValue({ id: 9 } as never);
    await expect(duplicateProject(admin, 5, 'Existant', false)).rejects.toMatchObject({
      statusCode: 400,
      code: 'SLUG_TAKEN',
    });
  });

  it('recreates sequences+shots remapping the sequence, without tasks when includeTasks=false', async () => {
    findFirst.mockResolvedValue({
      studioId: 1,
      description: 'd',
      startFrame: 1001,
      settings: { isTemplate: true, departments: ['comp'] },
      sequences: [{ id: 7, name: 'SQ01', code: 'SQ01', order: 0, settings: {} }],
      shots: [
        {
          id: 11,
          sequenceId: 7,
          name: 'SH01',
          code: 'SH01',
          startFrame: null,
          endFrame: null,
          order: 0,
          settings: {},
          tasks: [{ name: 't', type: TaskType.OTHER, order: 0, checklist: [] }],
        },
        {
          id: 12,
          sequenceId: null,
          name: 'SH02',
          code: 'SH02',
          startFrame: null,
          endFrame: null,
          order: 1,
          settings: {},
        },
      ],
    } as never);
    findUnique.mockResolvedValue(null);
    const { tx, created } = makeTx();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: unknown) => unknown) =>
      fn(tx)) as never);

    await duplicateProject(admin, 5, 'Nouveau', false);

    // The isTemplate marker is removed from the copied settings.
    expect(tx.project.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ settings: { departments: ['comp'] } }) }),
    );
    // Shot attached to the new sequence (id remapped), shot outside any sequence stays null.
    const seqNewId = created.sequences[0]!.id;
    expect(created.shots.find((s) => s.code === 'SH01')!.sequenceId).toBe(seqNewId);
    expect(created.shots.find((s) => s.code === 'SH02')!.sequenceId).toBeNull();
    // No tasks copied.
    expect(created.tasks).toHaveLength(0);
    // Grouped writes: one call per entity, not one per row (P2028 at 5 s otherwise).
    expect(tx.sequence.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.shot.createManyAndReturn).toHaveBeenCalledTimes(1);
  });

  it("gives an explicit deadline to the transaction (Prisma's default 5 s is not enough)", async () => {
    findFirst.mockResolvedValue({
      studioId: 1,
      description: null,
      startFrame: 1001,
      settings: {},
      sequences: [],
      shots: [],
    } as never);
    findUnique.mockResolvedValue(null);
    const { tx } = makeTx();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: unknown) => unknown) =>
      fn(tx)) as never);

    await duplicateProject(admin, 5, 'Vide', false);

    const options = vi.mocked(prisma.$transaction).mock.calls[0]![1];
    expect(options?.timeout).toBeGreaterThan(5_000);
  });

  it("copies the shots' tasks when includeTasks=true (default status, no assignee)", async () => {
    findFirst.mockResolvedValue({
      studioId: 1,
      description: null,
      startFrame: 1001,
      settings: {},
      sequences: [],
      shots: [
        {
          id: 11,
          sequenceId: null,
          name: 'SH01',
          code: 'SH01',
          startFrame: null,
          endFrame: null,
          order: 0,
          settings: {},
          tasks: [{ name: 'comp', type: TaskType.OTHER, order: 0, checklist: [{ text: 'a', done: false }] }],
        },
      ],
    } as never);
    findUnique.mockResolvedValue(null);
    const { tx, created } = makeTx();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: unknown) => unknown) =>
      fn(tx)) as never);

    await duplicateProject(admin, 5, 'Avec tâches', true);

    expect(created.tasks).toHaveLength(1);
    expect(created.tasks[0]).toMatchObject({ name: 'comp', checklist: [{ text: 'a', done: false }] });
    expect(created.tasks[0]).not.toHaveProperty('assigneeId');
    // The task targets the NEW shot, found by (sequenceId, code) and not by return order.
    expect(created.tasks[0]!.shotId).toBe(created.shots[0]!.id);
    expect(tx.task.createMany).toHaveBeenCalledTimes(1);
  });

  it('attaches each task to its shot when two sequences carry the same shot code', async () => {
    findFirst.mockResolvedValue({
      studioId: 1,
      description: null,
      startFrame: 1001,
      settings: {},
      sequences: [
        { id: 7, name: 'SQ01', code: 'SQ01', order: 0, settings: {} },
        { id: 8, name: 'SQ02', code: 'SQ02', order: 1, settings: {} },
      ],
      shots: [
        {
          id: 11,
          sequenceId: 7,
          name: 'SH010',
          code: 'SH010',
          startFrame: null,
          endFrame: null,
          order: 0,
          settings: {},
          tasks: [{ name: 'anim-sq01', type: TaskType.OTHER, order: 0, checklist: [] }],
        },
        {
          id: 12,
          sequenceId: 8,
          name: 'SH010',
          code: 'SH010',
          startFrame: null,
          endFrame: null,
          order: 0,
          settings: {},
          tasks: [{ name: 'anim-sq02', type: TaskType.OTHER, order: 0, checklist: [] }],
        },
      ],
    } as never);
    findUnique.mockResolvedValue(null);
    const { tx, created } = makeTx();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: unknown) => unknown) =>
      fn(tx)) as never);

    await duplicateProject(admin, 5, 'Deux séquences', true);

    const sq01 = created.sequences.find((s) => s.code === 'SQ01')!.id;
    const sq02 = created.sequences.find((s) => s.code === 'SQ02')!.id;
    const shotOfSq01 = created.shots.find((s) => s.sequenceId === sq01)!.id;
    const shotOfSq02 = created.shots.find((s) => s.sequenceId === sq02)!.id;
    expect(created.tasks.find((t) => t.name === 'anim-sq01')!.shotId).toBe(shotOfSq01);
    expect(created.tasks.find((t) => t.name === 'anim-sq02')!.shotId).toBe(shotOfSq02);
  });
});
