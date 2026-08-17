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
vi.mock('../lib/thumbnails', () => ({
  firstMediaThumbKeyForProject: vi.fn(),
  effectiveThumbnailUrl: vi.fn(),
}));

import { duplicateProject } from './ProjectService';
import { prisma } from '../lib/prisma';
import { TaskType } from '@prisma/client';

const findFirst = vi.mocked(prisma.project.findFirst);
const findUnique = vi.mocked(prisma.project.findUnique);
const admin = { id: 1, role: 'ADMIN' as const };

// Formes minimales des créations capturées : le service ne lit que id + colonnes copiées.
type Row = { id: number } & Record<string, unknown>;
type CreateArgs = { data: Record<string, unknown> };

// tx factice : ids séquentiels par entité, capture des créations.
function makeTx() {
  const created = { sequences: [] as Row[], shots: [] as Row[], tasks: [] as CreateArgs['data'][] };
  let seqId = 100;
  let shotId = 200;
  return {
    tx: {
      project: { create: vi.fn().mockResolvedValue({ id: 42 }) },
      sequence: {
        create: vi.fn((args: CreateArgs) => {
          const row: Row = { ...args.data, id: ++seqId };
          created.sequences.push(row);
          return Promise.resolve(row);
        }),
      },
      shot: {
        create: vi.fn((args: CreateArgs) => {
          const row: Row = { ...args.data, id: ++shotId };
          created.shots.push(row);
          return Promise.resolve(row);
        }),
      },
      task: {
        create: vi.fn((args: CreateArgs) => {
          created.tasks.push(args.data);
          return Promise.resolve({ ...args.data, id: 1 });
        }),
      },
    },
    created,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('ProjectService.duplicateProject (38.A)', () => {
  it('404 si le projet source est introuvable', async () => {
    findFirst.mockResolvedValue(null);
    await expect(duplicateProject(admin, 5, 'Copie', false)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('400 SLUG_TAKEN si un projet porte déjà ce nom', async () => {
    findFirst.mockResolvedValue({ studioId: 1, sequences: [], shots: [], settings: {} } as never);
    findUnique.mockResolvedValue({ id: 9 } as never);
    await expect(duplicateProject(admin, 5, 'Existant', false)).rejects.toMatchObject({
      statusCode: 400,
      code: 'SLUG_TAKEN',
    });
  });

  it('recrée séquences+shots en remappant la séquence, sans tâches quand includeTasks=false', async () => {
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

    // Le marqueur isTemplate est retiré des réglages copiés.
    expect(tx.project.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ settings: { departments: ['comp'] } }) }),
    );
    // Shot rattaché à la nouvelle séquence (id remappé), shot hors séquence reste null.
    const seqNewId = created.sequences[0]!.id;
    expect(created.shots.find((s) => s.code === 'SH01')!.sequenceId).toBe(seqNewId);
    expect(created.shots.find((s) => s.code === 'SH02')!.sequenceId).toBeNull();
    // Pas de tâches copiées.
    expect(created.tasks).toHaveLength(0);
  });

  it('copie les tâches des shots quand includeTasks=true (statut par défaut, sans assigné)', async () => {
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
  });
});
