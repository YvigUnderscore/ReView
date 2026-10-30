// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, pipeline, resolveFavorites } = vi.hoisted(() => ({
  db: { favorite: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() } },
  pipeline: {
    resolveProjectIdForSequence: vi.fn(),
    resolveProjectIdForShot: vi.fn(),
    resolveProjectIdForAsset: vi.fn(),
  },
  resolveFavorites: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/pipeline', () => pipeline);
vi.mock('../lib/favoriteEntities', () => ({ resolveFavorites }));

import { addFavorite, listFavorites, projectIdForEntity, removeFavorite } from './FavoriteService';

beforeEach(() => vi.clearAllMocks());

describe('projectIdForEntity', () => {
  it('a project is its own project', async () => {
    expect(await projectIdForEntity('PROJECT', 5)).toBe(5);
  });

  it('resolves sequences, shots and assets through the pipeline', async () => {
    pipeline.resolveProjectIdForSequence.mockResolvedValue(1);
    pipeline.resolveProjectIdForShot.mockResolvedValue(2);
    pipeline.resolveProjectIdForAsset.mockResolvedValue(null);
    expect(await projectIdForEntity('SEQUENCE', 10)).toBe(1);
    expect(await projectIdForEntity('SHOT', 11)).toBe(2);
    expect(await projectIdForEntity('ASSET', 12)).toBeNull();
    expect(pipeline.resolveProjectIdForShot).toHaveBeenCalledWith(11);
  });
});

describe('listFavorites', () => {
  it("reads the user's rows newest first and re-filters them by access", async () => {
    const rows = [{ id: 1, type: 'SHOT', entityId: 4 }];
    db.favorite.findMany.mockResolvedValue(rows);
    resolveFavorites.mockResolvedValue([{ id: 1, label: 'AAA_010' }]);
    const out = await listFavorites({ id: 7, role: 'ARTIST' });
    expect(db.favorite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 7 }, orderBy: { createdAt: 'desc' } }),
    );
    expect(resolveFavorites).toHaveBeenCalledWith(7, 'ARTIST', rows);
    expect(out).toEqual([{ id: 1, label: 'AAA_010' }]);
  });
});

describe('addFavorite / removeFavorite', () => {
  it('upserts on the (user, type, entity) key', async () => {
    db.favorite.upsert.mockResolvedValue({ id: 3 });
    expect(await addFavorite(7, 'SHOT', 4)).toEqual({ id: 3 });
    expect(db.favorite.upsert).toHaveBeenCalledWith({
      where: { userId_type_entityId: { userId: 7, type: 'SHOT', entityId: 4 } },
      update: {},
      create: { userId: 7, type: 'SHOT', entityId: 4 },
    });
  });

  it('removal is scoped to the user and idempotent', async () => {
    db.favorite.deleteMany.mockResolvedValue({ count: 0 });
    await expect(removeFavorite(7, 'SHOT', 4)).resolves.toBeUndefined();
    expect(db.favorite.deleteMany).toHaveBeenCalledWith({ where: { userId: 7, type: 'SHOT', entityId: 4 } });
  });
});
