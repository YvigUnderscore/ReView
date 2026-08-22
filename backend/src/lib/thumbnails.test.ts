// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({ prisma: { mediaObject: { findMany: vi.fn(), findFirst: vi.fn() } } }));
vi.mock('../services/StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`https://minio/${key}`)) },
}));

import {
  effectiveThumbnailUrl,
  firstMediaThumbKeysForShots,
  firstMediaThumbKeysForAssets,
} from './thumbnails';
import { prisma } from './prisma';
import { storage } from '../services/StorageService';

const findMany = vi.mocked(prisma.mediaObject.findMany);

beforeEach(() => vi.clearAllMocks());

/**
 * La miniature « effective » d'une carte : celle choisie à la main si elle existe, sinon
 * celle du premier média publié. C'est le seul point qui présigne les vignettes de liste —
 * une centaine d'appels par ouverture de projet.
 */
describe('effectiveThumbnailUrl', () => {
  it('préfère la vignette explicite au repli', async () => {
    await expect(effectiveThumbnailUrl('entity-thumbs/shot/1.jpg', 'derived/9/thumbnail.jpg')).resolves.toBe(
      'https://minio/entity-thumbs/shot/1.jpg',
    );
  });

  it('retombe sur le premier média publié', async () => {
    await expect(effectiveThumbnailUrl(null, 'derived/9/thumbnail.jpg')).resolves.toBe(
      'https://minio/derived/9/thumbnail.jpg',
    );
  });

  it('ne signe rien quand l’entité n’a aucune image', async () => {
    await expect(effectiveThumbnailUrl(null, null)).resolves.toBeNull();
    expect(storage.getPresignedGetUrl).not.toHaveBeenCalled();
  });
});

/**
 * Variantes groupées : une requête pour toute une page de cartes. La règle d'élection
 * (le média publié le plus ancien gagne) est celle de la variante unitaire — la vérifier
 * ici évite qu'une page ne change de vignette selon le chemin de code emprunté.
 */
describe('miniatures groupées', () => {
  it('élit le média le plus ancien de chaque plan, en une requête', async () => {
    findMany.mockResolvedValue([
      { thumbnailKey: 'a.jpg', version: { assetId: null, task: { shotId: 1, assetId: null } } },
      { thumbnailKey: 'b.jpg', version: { assetId: null, task: { shotId: 1, assetId: null } } },
      { thumbnailKey: 'c.jpg', version: { assetId: null, task: { shotId: 2, assetId: null } } },
    ] as never);
    await expect(firstMediaThumbKeysForShots([1, 2])).resolves.toEqual(
      new Map([
        [1, 'a.jpg'],
        [2, 'c.jpg'],
      ]),
    );
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { published: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('rattache l’asset porté par la version comme celui porté par la tâche', async () => {
    findMany.mockResolvedValue([
      { thumbnailKey: 'direct.jpg', version: { assetId: 5, task: null } },
      { thumbnailKey: 'viaTask.jpg', version: { assetId: null, task: { shotId: null, assetId: 6 } } },
    ] as never);
    await expect(firstMediaThumbKeysForAssets([5, 6])).resolves.toEqual(
      new Map([
        [5, 'direct.jpg'],
        [6, 'viaTask.jpg'],
      ]),
    );
  });

  it('n’interroge pas la base pour une page vide', async () => {
    await expect(firstMediaThumbKeysForShots([])).resolves.toEqual(new Map());
    await expect(firstMediaThumbKeysForAssets([])).resolves.toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });
});
