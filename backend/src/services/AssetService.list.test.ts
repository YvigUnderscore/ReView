// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, thumbs } = vi.hoisted(() => ({
  db: {
    asset: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    // Pastille « attend une review » : un agrégat SQL groupé pour la page entière.
    $queryRaw: vi.fn(),
  },
  thumbs: {
    firstMediaThumbKeysForAssets: vi.fn(),
    firstMediaThumbKeyForAsset: vi.fn(),
    effectiveThumbnailUrl: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('../lib/thumbnails', () => thumbs);

import { list, getDetail } from './AssetService';
import { decodeCursor, encodeCursor } from '../lib/pagination';

const page = { page: 1, pageSize: 100, order: 'desc' as const };

beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockResolvedValue([]);
  db.asset.findMany.mockResolvedValue([{ id: 4, name: 'Ship', thumbnailKey: null }]);
  db.asset.count.mockResolvedValue(1);
  thumbs.firstMediaThumbKeysForAssets.mockResolvedValue(new Map());
  thumbs.firstMediaThumbKeyForAsset.mockResolvedValue(null);
  thumbs.effectiveThumbnailUrl.mockResolvedValue(null);
});

describe('AssetService.list', () => {
  it('trie par nom puis id, la même règle que partout ailleurs', async () => {
    await list(3, page);
    expect(db.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('garde les étapes et les tâches que le menu contextuel des cartes consomme', async () => {
    await list(3, page);
    const args = db.asset.findMany.mock.calls[0]![0] as { include: Record<string, unknown> };
    expect(args.include.departments).toBeDefined();
    expect(args.include.tasks).toBeDefined();
    expect(args.include._count).toEqual({ select: { versions: true, tasks: true } });
  });

  it('résout les vignettes en une passe groupée', async () => {
    await list(3, page);
    expect(thumbs.firstMediaThumbKeysForAssets).toHaveBeenCalledTimes(1);
    expect(thumbs.firstMediaThumbKeysForAssets).toHaveBeenCalledWith([4]);
  });

  it('reprend après le curseur sur le couple (name, id)', async () => {
    await list(3, { ...page, cursor: encodeCursor('Ship', 4) });
    const args = db.asset.findMany.mock.calls[0]![0] as { skip: number; where: { AND: unknown[] } };
    expect(args.skip).toBe(0);
    expect(args.where.AND).toEqual([
      { OR: [{ name: { gt: 'Ship' } }, { AND: [{ name: 'Ship' }, { id: { gt: 4 } }] }] },
    ]);
  });

  it('rend un curseur de suite quand la page est pleine', async () => {
    db.asset.findMany.mockResolvedValue([
      { id: 4, name: 'Ship', thumbnailKey: null },
      { id: 9, name: 'Tank', thumbnailKey: null },
    ]);
    db.asset.count.mockResolvedValue(1000);
    const res = await list(3, { ...page, pageSize: 2 });
    expect(res).toMatchObject({ total: 1000, pageCount: 500, hasMore: true });
    expect(decodeCursor(res.nextCursor ?? undefined)).toEqual({ value: 'Tank', id: 9 });
  });
});

describe('AssetService.getDetail', () => {
  it('borne l’historique de versions et rend le compte réel', async () => {
    db.asset.findUnique.mockResolvedValue({ id: 4, projectId: 3, thumbnailKey: null });
    await getDetail(4);
    const include = db.asset.findUnique.mock.calls[0]![0].include as {
      versions: { take: number; orderBy: unknown };
      tasks: { take: number; orderBy: unknown };
      _count: unknown;
    };
    expect(include.versions).toMatchObject({
      take: 200,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(include.tasks).toMatchObject({ take: 200, orderBy: [{ order: 'asc' }, { id: 'asc' }] });
    expect(include._count).toEqual({ select: { versions: true, tasks: true } });
  });

  it('signale un asset absent plutôt que de rendre un objet vide', async () => {
    db.asset.findUnique.mockResolvedValue(null);
    await expect(getDetail(404)).rejects.toThrow();
  });

  it('calcule la vignette de la fiche comme avant le déplacement depuis la route', async () => {
    db.asset.findUnique.mockResolvedValue({ id: 4, projectId: 3, thumbnailKey: 'k.jpg' });
    thumbs.effectiveThumbnailUrl.mockResolvedValue('url:k.jpg');
    await expect(getDetail(4)).resolves.toMatchObject({ thumbnailUrl: 'url:k.jpg' });
    expect(thumbs.firstMediaThumbKeyForAsset).toHaveBeenCalledWith(4);
  });
});
