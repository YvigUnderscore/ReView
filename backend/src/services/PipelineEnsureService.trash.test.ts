// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, Role } from '@prisma/client';

// Les ensures doivent rester rejouables même quand la contrainte SQL voit une entité
// que la recherche préalable ignore (corbeille) ou qu'une requête concurrente vient
// de créer. On mocke la base : seul le rattrapage de P2002 est sous test.
vi.mock('../lib/prisma', () => ({
  prisma: {
    sequence: { findFirst: vi.fn(), create: vi.fn() },
    shot: { findFirst: vi.fn(), create: vi.fn() },
    asset: { findFirst: vi.fn(), create: vi.fn() },
    task: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    version: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectRoles', () => ({
  assertProjectManage: vi.fn(),
  assertCanContribute: vi.fn(),
}));

import { ensureSequence, ensureShot, ensureAsset, ensureTask, ensureVersion } from './PipelineEnsureService';
import { prisma } from '../lib/prisma';
import { emitToProject } from './SocketService';

const admin = { id: 1, role: Role.ADMIN };

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureAsset — idempotent face à la corbeille et à la concurrence', () => {
  it("renvoie l'asset existant sans créer (created: false)", async () => {
    const existing = { id: 59, name: 'crag' };
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(existing as never);
    const out = await ensureAsset(admin, 7, { name: 'crag' });
    expect(out).toEqual({ entity: existing, created: false });
    expect(prisma.asset.create).not.toHaveBeenCalled();
  });

  it('répond 409 ASSET_IN_TRASH quand le nom est retenu par un asset supprimé', async () => {
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.asset.create).mockRejectedValue(uniqueViolation());
    await expect(ensureAsset(admin, 7, { name: 'crag' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ASSET_IN_TRASH',
    });
    expect(emitToProject).not.toHaveBeenCalled();
  });

  it("renvoie l'asset créé par une requête concurrente (created: false)", async () => {
    const winner = { id: 96, name: 'crag' };
    vi.mocked(prisma.asset.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner as never);
    vi.mocked(prisma.asset.create).mockRejectedValue(uniqueViolation());
    const out = await ensureAsset(admin, 7, { name: 'crag' });
    expect(out).toEqual({ entity: winner, created: false });
    expect(emitToProject).not.toHaveBeenCalled();
  });

  it('laisse passer les erreurs qui ne sont pas une violation d’unicité', async () => {
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.asset.create).mockRejectedValue(new Error('connexion perdue'));
    await expect(ensureAsset(admin, 7, { name: 'crag' })).rejects.toThrow('connexion perdue');
  });
});

describe('ensureSequence — idempotent face à la corbeille et à la concurrence', () => {
  it('répond 409 SEQUENCE_IN_TRASH quand le code est retenu par une séquence supprimée', async () => {
    vi.mocked(prisma.sequence.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.sequence.create).mockRejectedValue(uniqueViolation());
    await expect(ensureSequence(admin, 7, { code: 'SQ010' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'SEQUENCE_IN_TRASH',
    });
  });

  it('renvoie la séquence créée par une requête concurrente (created: false)', async () => {
    const winner = { id: 4, code: 'SQ010' };
    vi.mocked(prisma.sequence.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner as never);
    vi.mocked(prisma.sequence.create).mockRejectedValue(uniqueViolation());
    const out = await ensureSequence(admin, 7, { code: 'SQ010' });
    expect(out).toEqual({ entity: winner, created: false });
  });
});

describe('ensureTask — idempotent face à la concurrence', () => {
  // Le nom « main » ne laisse deviner aucun département : la résolution n'entre pas en jeu.
  const task = { name: 'main' };

  it('renvoie la tâche créée par une requête concurrente (created: false)', async () => {
    // Deux publications simultanées d'une ferme de rendu : une seule tâche doit exister.
    const winner = { id: 77, name: 'main' };
    vi.mocked(prisma.task.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner as never);
    vi.mocked(prisma.task.create).mockRejectedValue(uniqueViolation());
    const out = await ensureTask(admin, 7, { shotId: 3 }, task);
    expect(out).toEqual({ entity: winner, created: false });
    expect(emitToProject).not.toHaveBeenCalled();
  });

  it('répond 409 TASK_EXISTS quand la relecture ne retrouve rien', async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.task.create).mockRejectedValue(uniqueViolation());
    await expect(ensureTask(admin, 7, { shotId: 3 }, task)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TASK_EXISTS',
    });
  });

  it('laisse passer les erreurs qui ne sont pas une violation d’unicité', async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.task.create).mockRejectedValue(new Error('connexion perdue'));
    await expect(ensureTask(admin, 7, { shotId: 3 }, task)).rejects.toThrow('connexion perdue');
  });
});

describe('ensureVersion — idempotent face à la corbeille et à la concurrence', () => {
  const parent = { taskId: 5 };

  it('recalcule le numéro plutôt que de rendre la version d’un collègue', async () => {
    // Sans nom demandé, l'appelant veut LA SUIVANTE : lui rendre la V02 que l'autre
    // publication vient de créer rattacherait son média au travail d'un collègue.
    vi.mocked(prisma.version.findMany)
      .mockResolvedValueOnce([{ name: 'V01' }] as never)
      .mockResolvedValueOnce([{ name: 'V01' }, { name: 'V02' }] as never);
    vi.mocked(prisma.version.create)
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce({ id: 31, name: 'V03' } as never);
    const out = await ensureVersion(admin, 7, parent);
    expect(out).toEqual({ entity: { id: 31, name: 'V03' }, created: true });
    const names = vi.mocked(prisma.version.create).mock.calls.map((c) => c[0].data.name);
    expect(names).toEqual(['V02', 'V03']);
  });

  it('abandonne proprement si le numéro reste pris', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.version.create).mockRejectedValue(uniqueViolation());
    await expect(ensureVersion(admin, 7, parent)).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERSION_RACE',
    });
    expect(prisma.version.create).toHaveBeenCalledTimes(3);
  });

  it('répond 409 VERSION_IN_TRASH quand le nom est retenu par une version supprimée', async () => {
    vi.mocked(prisma.version.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.version.create).mockRejectedValue(uniqueViolation());
    await expect(ensureVersion(admin, 7, parent, { name: 'V03' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERSION_IN_TRASH',
    });
  });

  it('rend la version créée par une requête concurrente quand la reprise est demandée', async () => {
    const winner = { id: 12, name: 'V03' };
    vi.mocked(prisma.version.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner as never);
    vi.mocked(prisma.version.create).mockRejectedValue(uniqueViolation());
    const out = await ensureVersion(admin, 7, parent, { name: 'V03', reuseExisting: true });
    expect(out).toEqual({ entity: winner, created: false });
    expect(emitToProject).not.toHaveBeenCalled();
  });

  it('refuse d’écraser la version d’une requête concurrente sans reprise explicite', async () => {
    vi.mocked(prisma.version.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 12, name: 'V03' } as never);
    vi.mocked(prisma.version.create).mockRejectedValue(uniqueViolation());
    await expect(ensureVersion(admin, 7, parent, { name: 'V03' })).rejects.toMatchObject({
      code: 'VERSION_EXISTS',
    });
  });
});

describe('ensureShot — idempotent face à la corbeille et à la concurrence', () => {
  it('répond 409 SHOT_IN_TRASH quand le code est retenu par un shot supprimé', async () => {
    vi.mocked(prisma.sequence.findFirst).mockResolvedValue({ id: 4 } as never);
    vi.mocked(prisma.shot.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.shot.create).mockRejectedValue(uniqueViolation());
    await expect(ensureShot(admin, 7, { code: 'SH0100', sequenceCode: 'SQ010' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'SHOT_IN_TRASH',
    });
  });

  it('renvoie le shot créé par une requête concurrente (created: false)', async () => {
    const winner = { id: 8, code: 'SH0100' };
    vi.mocked(prisma.sequence.findFirst).mockResolvedValue({ id: 4 } as never);
    vi.mocked(prisma.shot.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner as never);
    vi.mocked(prisma.shot.create).mockRejectedValue(uniqueViolation());
    const out = await ensureShot(admin, 7, { code: 'SH0100', sequenceCode: 'SQ010' });
    expect(out).toEqual({ entity: winner, created: false });
  });
});
