// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, thumbs } = vi.hoisted(() => ({
  db: {
    shot: { findMany: vi.fn(), count: vi.fn() },
  },
  thumbs: {
    firstMediaThumbKeysForShots: vi.fn(),
    effectiveThumbnailUrl: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('./PipelineStatusService', () => ({ assertBelongsToProject: vi.fn() }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('../lib/thumbnails', () => ({
  firstMediaThumbKeyForShot: vi.fn(),
  firstMediaThumbKeysForShots: thumbs.firstMediaThumbKeysForShots,
  effectiveThumbnailUrl: thumbs.effectiveThumbnailUrl,
}));

import { list } from './ShotService';
import { decodeCursor, encodeCursor } from '../lib/pagination';

const page = { page: 1, pageSize: 100, order: 'desc' as const };

beforeEach(() => {
  vi.clearAllMocks();
  db.shot.findMany.mockResolvedValue([
    {
      id: 7,
      code: 'SH010',
      thumbnailKey: null,
      departments: [{ id: 3, key: 'comp', name: 'Compositing', color: null }],
    },
  ]);
  db.shot.count.mockResolvedValue(1);
  thumbs.firstMediaThumbKeysForShots.mockResolvedValue(new Map());
  thumbs.effectiveThumbnailUrl.mockResolvedValue(null);
});

describe('ShotService.list — étapes traversées', () => {
  it('demande les départements de chaque plan', async () => {
    // Le filtre par département de l'onglet Shots compare les étapes que le plan traverse.
    // La liste ne les renvoyait pas — seule la fiche le faisait — et choisir un
    // département vidait l'écran : aucune carte n'avait d'étape à comparer.
    await list(461, undefined, page);
    expect(db.shot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          departments: {
            select: { id: true, key: true, name: true, color: true },
            orderBy: { order: 'asc' },
          },
        }),
      }),
    );
  });

  it('laisse les départements intacts dans la réponse', async () => {
    const { items } = await list(461, undefined, page);
    expect(items[0]).toMatchObject({ departments: [{ id: 3, name: 'Compositing' }] });
  });
});

describe('ShotService.list — pagination de deux mille plans', () => {
  it('départage le tri par id', async () => {
    // Un import ShotGrid incrémental laisse tous les plans créés à order = 0 : sans
    // départage, Postgres est libre de rendre les ex æquo dans un ordre différent d'une
    // page à l'autre — la page 2 réaffiche des plans de la page 1 et en saute autant.
    await list(461, undefined, page);
    expect(db.shot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('applique skip/take en mode page', async () => {
    await list(461, undefined, { ...page, page: 3, pageSize: 50 });
    expect(db.shot.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, take: 50 }));
  });

  it('reprend après le curseur, sans décalage, et compte quand même le total', async () => {
    await list(461, undefined, { ...page, page: 4, cursor: encodeCursor(0, 812) });
    const args = db.shot.findMany.mock.calls[0]![0] as {
      skip: number;
      where: { AND: unknown[]; projectId: number };
    };
    expect(args.skip).toBe(0);
    expect(args.where.AND).toEqual([
      { OR: [{ order: { gt: 0 } }, { AND: [{ order: 0 }, { id: { gt: 812 } }] }] },
    ]);
    // Le total reste celui du projet entier : c'est lui qu'affiche « 2 000 plans ».
    expect(db.shot.count).toHaveBeenCalledWith({ where: { projectId: 461, deletedAt: null } });
  });

  it('rend un curseur de suite quand la page est pleine', async () => {
    db.shot.findMany.mockResolvedValue([
      { id: 7, order: 0, code: 'SH010', thumbnailKey: null, departments: [] },
      { id: 9, order: 0, code: 'SH020', thumbnailKey: null, departments: [] },
    ]);
    db.shot.count.mockResolvedValue(2000);
    const res = await list(461, undefined, { ...page, pageSize: 2 });
    expect(res).toMatchObject({ total: 2000, pageCount: 1000, hasMore: true });
    expect(decodeCursor(res.nextCursor ?? undefined)).toEqual({ value: 0, id: 9 });
  });

  it('ne rend pas de curseur sur la dernière page', async () => {
    const res = await list(461, undefined, page);
    expect(res.nextCursor).toBeNull();
    expect(res.hasMore).toBe(false);
  });
});
