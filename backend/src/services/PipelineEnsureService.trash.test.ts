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
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectRoles', () => ({
  assertProjectManage: vi.fn(),
  assertCanContribute: vi.fn(),
}));

import { ensureSequence, ensureShot, ensureAsset } from './PipelineEnsureService';
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
