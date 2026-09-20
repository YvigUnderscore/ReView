// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    entityVisit: { findMany: vi.fn(), upsert: vi.fn() },
    shot: { findMany: vi.fn() },
    sequence: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));
vi.mock('../lib/entityFreshness', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/entityFreshness')>();
  return { ...real, activityByShot: vi.fn(), activityBySequence: vi.fn(), activityByAsset: vi.fn() };
});

import {
  markManyVisited,
  markVisited,
  unseenByAsset,
  unseenBySequence,
  unseenByShot,
  visitableIdsOfProject,
  visitedAtFor,
} from './EntityVisitService';
import { prisma } from '../lib/prisma';
import { activityByAsset, activityBySequence, activityByShot } from '../lib/entityFreshness';

const d = (iso: string) => new Date(iso);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('visitedAtFor', () => {
  it('une seule requête pour toute la page', async () => {
    vi.mocked(prisma.entityVisit.findMany).mockResolvedValue([
      { targetId: 3, visitedAt: d('2026-02-01T00:00:00Z') },
    ] as never);
    const out = await visitedAtFor(1, 'SHOT', [3, 4, 5]);
    expect(prisma.entityVisit.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.entityVisit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1, targetType: 'SHOT', targetId: { in: [3, 4, 5] } } }),
    );
    expect(out.get(3)).toEqual(d('2026-02-01T00:00:00Z'));
    expect(out.has(4)).toBe(false);
  });

  it('page vide : aucune requête', async () => {
    expect((await visitedAtFor(1, 'SHOT', [])).size).toBe(0);
    expect(prisma.entityVisit.findMany).not.toHaveBeenCalled();
  });
});

describe('markVisited', () => {
  it('écrase la date — deux ouvertures ne font pas deux lignes', async () => {
    const at = await markVisited(1, 'SHOT', 7);
    expect(prisma.entityVisit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_targetType_targetId: { userId: 1, targetType: 'SHOT', targetId: 7 } },
        update: { visitedAt: at },
      }),
    );
  });
});

describe('markManyVisited', () => {
  it('une seule instruction pour toute la liste, et elle est en ON CONFLICT', async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValue(3);
    expect(await markManyVisited(1, 'SHOT', [7, 8, 9])).toBe(3);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // `upsert` carte par carte aurait demandé deux mille allers-retours sur un
    // long-métrage ; `deleteMany` + `createMany` aurait laissé une course sur l'unicité.
    const sql = vi.mocked(prisma.$executeRaw).mock.calls.flat().join(' ');
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE SET');
  });

  it('liste vide : rien n’est écrit', async () => {
    expect(await markManyVisited(1, 'SHOT', [])).toBe(0);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('visitableIdsOfProject', () => {
  it('écarte la corbeille et le masquage — « tout » ne vise que ce qui est listé', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
    expect(await visitableIdsOfProject(5, 'SHOT')).toEqual([1, 2]);
    expect(prisma.shot.findMany).toHaveBeenCalledWith({
      where: { projectId: 5, deletedAt: null, hiddenAt: null },
      select: { id: true },
    });
  });

  it('couvre les trois listes qui portent le bouton', async () => {
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([{ id: 8 }] as never);
    vi.mocked(prisma.asset.findMany).mockResolvedValue([{ id: 9 }] as never);
    expect(await visitableIdsOfProject(5, 'SEQUENCE')).toEqual([8]);
    expect(await visitableIdsOfProject(5, 'ASSET')).toEqual([9]);
  });

  it('un type sans liste ne marque rien plutôt que de deviner', async () => {
    expect(await visitableIdsOfProject(5, 'BOARD')).toEqual([]);
    expect(prisma.shot.findMany).not.toHaveBeenCalled();
  });
});

describe('unseenBy* — composition activité × visite', () => {
  it('confronte l’activité du plan à ma visite', async () => {
    vi.mocked(activityByShot).mockResolvedValue(
      new Map([
        [1, d('2026-02-01T00:00:00Z')],
        [2, d('2026-02-01T00:00:00Z')],
      ]),
    );
    vi.mocked(prisma.entityVisit.findMany).mockResolvedValue([
      { targetId: 1, visitedAt: d('2026-03-01T00:00:00Z') },
    ] as never);
    const rows = [
      { id: 1, updatedAt: d('2026-01-01T00:00:00Z') },
      { id: 2, updatedAt: d('2026-01-01T00:00:00Z') },
    ];
    const out = await unseenByShot(42, rows);
    expect(out.get(1)).toBe(false);
    expect(out.get(2)).toBe(true);
  });

  it('interroge le bon type de cible pour chaque famille', async () => {
    vi.mocked(activityBySequence).mockResolvedValue(new Map());
    vi.mocked(activityByAsset).mockResolvedValue(new Map());
    vi.mocked(prisma.entityVisit.findMany).mockResolvedValue([] as never);
    const rows = [{ id: 1, updatedAt: d('2026-01-01T00:00:00Z') }];
    await unseenBySequence(42, rows);
    await unseenByAsset(42, rows);
    const types = vi
      .mocked(prisma.entityVisit.findMany)
      .mock.calls.map((c) => (c[0] as { where: { targetType: string } }).where.targetType);
    expect(types).toEqual(['SEQUENCE', 'ASSET']);
  });

  it('page vide : ni activité ni visite ne sont demandées', async () => {
    expect((await unseenByShot(42, [])).size).toBe(0);
    expect(activityByShot).not.toHaveBeenCalled();
    expect(prisma.entityVisit.findMany).not.toHaveBeenCalled();
  });
});
