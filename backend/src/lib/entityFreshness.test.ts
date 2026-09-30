// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({ prisma: { $queryRaw: vi.fn() } }));

import {
  activityByAsset,
  activityBySequence,
  activityByShot,
  mergeLatest,
  unseenFrom,
} from './entityFreshness';
import { prisma } from './prisma';

const d = (iso: string) => new Date(iso);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mergeLatest', () => {
  it('part de la date de l’entité et ne garde que plus récent', () => {
    const out = mergeLatest(
      [
        { id: 1, updatedAt: d('2026-01-10T00:00:00Z') },
        { id: 2, updatedAt: d('2026-01-10T00:00:00Z') },
      ],
      [
        [
          { id: 1, at: d('2026-01-05T00:00:00Z') },
          { id: 2, at: d('2026-02-01T00:00:00Z') },
        ],
      ],
    );
    // Plan 1 : la descendance est plus vieille, la date propre l'emporte.
    expect(out.get(1)).toEqual(d('2026-01-10T00:00:00Z'));
    // Plan 2 : c'est tout le piège du lot — la livraison a bougé, le plan non.
    expect(out.get(2)).toEqual(d('2026-02-01T00:00:00Z'));
  });

  it('ignore les agrégats vides sans perdre l’entité', () => {
    const out = mergeLatest([{ id: 7, updatedAt: d('2026-03-01T00:00:00Z') }], [[], [{ id: 7, at: null }]]);
    expect(out.get(7)).toEqual(d('2026-03-01T00:00:00Z'));
    expect(out.size).toBe(1);
  });
});

describe('unseenFrom', () => {
  const activity = new Map([
    [1, d('2026-02-01T00:00:00Z')],
    [2, d('2026-02-01T00:00:00Z')],
    [3, d('2026-02-01T00:00:00Z')],
  ]);

  it('jamais visité ⇒ non consulté', () => {
    expect(unseenFrom(activity, new Map()).get(1)).toBe(true);
  });

  it('visité après la dernière activité ⇒ consulté', () => {
    const visits = new Map([[2, d('2026-02-02T00:00:00Z')]]);
    expect(unseenFrom(activity, visits).get(2)).toBe(false);
  });

  it('visité avant ⇒ rallumé', () => {
    const visits = new Map([[3, d('2026-01-20T00:00:00Z')]]);
    expect(unseenFrom(activity, visits).get(3)).toBe(true);
  });

  it('à égalité parfaite, l’entité est réputée vue', () => {
    const visits = new Map([[1, d('2026-02-01T00:00:00Z')]]);
    expect(unseenFrom(activity, visits).get(1)).toBe(false);
  });
});

describe('lectures d’activité — forme des requêtes', () => {
  it('un plan : trois agrégats plats, aucune jointure imbriquée de deux niveaux', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    await activityByShot([{ id: 4, updatedAt: d('2026-01-01T00:00:00Z') }]);
    // Trois, et pas un par carte : c'est la multiplication par carte qui coûtait.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('une séquence : quatre agrégats (plans, tâches, livraisons, médias)', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    await activityBySequence([{ id: 9, updatedAt: d('2026-01-01T00:00:00Z') }]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it('un asset : trois agrégats, les DEUX chemins de rattachement compris', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    await activityByAsset([{ id: 2, updatedAt: d('2026-01-01T00:00:00Z') }]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    // `COALESCE(v."assetId", t."assetId")` : une version pend d'une tâche de l'asset OU
    // de l'asset lui-même. N'en suivre qu'un laissait la moitié des livraisons dehors.
    const sql = vi.mocked(prisma.$queryRaw).mock.calls.flat().join(' ');
    expect(sql).toContain('COALESCE');
  });

  it('liste vide : aucune requête', async () => {
    await Promise.all([activityByShot([]), activityBySequence([]), activityByAsset([])]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('relève bien la date de l’entité avec celle de sa descendance', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: 4, at: d('2026-01-02T00:00:00Z') }] as never)
      .mockResolvedValueOnce([{ id: 4, at: d('2026-05-01T00:00:00Z') }] as never)
      .mockResolvedValueOnce([] as never);
    const out = await activityByShot([{ id: 4, updatedAt: d('2026-01-01T00:00:00Z') }]);
    expect(out.get(4)).toEqual(d('2026-05-01T00:00:00Z'));
  });
});
