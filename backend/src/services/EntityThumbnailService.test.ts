// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    sequence: { findFirst: vi.fn(), update: vi.fn() },
    shot: { findFirst: vi.fn(), update: vi.fn() },
    asset: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('./StorageService', () => ({
  storage: {
    getPresignedPutUrl: vi.fn().mockResolvedValue('https://minio/put'),
    forgetPresignedUrl: vi.fn(),
  },
  StorageService: {
    entityThumbnailKey: (holder: string, id: number, ext: string) => `entity-thumbs/${holder}/${id}${ext}`,
  },
}));

import { presign, resolveProject, set } from './EntityThumbnailService';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';

beforeEach(() => vi.clearAllMocks());

describe('resolveProject', () => {
  it('rend le projet porteur, entité par entité', async () => {
    vi.mocked(prisma.sequence.findFirst).mockResolvedValue({ projectId: 7 } as never);
    vi.mocked(prisma.shot.findFirst).mockResolvedValue({ projectId: 8 } as never);
    vi.mocked(prisma.asset.findFirst).mockResolvedValue({ projectId: 9 } as never);
    await expect(resolveProject('sequence', 1)).resolves.toBe(7);
    await expect(resolveProject('shot', 1)).resolves.toBe(8);
    await expect(resolveProject('asset', 1)).resolves.toBe(9);
  });

  it('refuse une entité en corbeille comme une entité absente', async () => {
    vi.mocked(prisma.shot.findFirst).mockResolvedValue(null);
    await expect(resolveProject('shot', 1)).rejects.toThrow();
    // La corbeille est bien dans le filtre, pas seulement l'identifiant.
    expect(vi.mocked(prisma.shot.findFirst).mock.calls[0]![0]).toMatchObject({
      where: { id: 1, deletedAt: null },
    });
  });
});

describe('presign', () => {
  it('construit la clé depuis le type d’image, sans rien recevoir du client', async () => {
    await expect(presign('asset', 42, 'image/png')).resolves.toEqual({
      url: 'https://minio/put',
      key: 'entity-thumbs/asset/42.png',
    });
    await expect(presign('shot', 3, 'image/jpeg')).resolves.toMatchObject({
      key: 'entity-thumbs/shot/3.jpg',
    });
    await expect(presign('sequence', 5, 'image/webp')).resolves.toMatchObject({
      key: 'entity-thumbs/sequence/5.webp',
    });
  });

  it('rejette un type qui n’est pas une image reconnue', async () => {
    await expect(presign('asset', 1, 'application/pdf')).rejects.toThrow();
    await expect(presign('asset', 1, 'image/gif')).rejects.toThrow();
  });
});

describe('set', () => {
  it('enregistre une clé qui désigne bien l’entité', async () => {
    await set('shot', 12, 'entity-thumbs/shot/12.jpg');
    expect(prisma.shot.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { thumbnailKey: 'entity-thumbs/shot/12.jpg' },
    });
  });

  it('efface la vignette : l’entité retombe sur le média publié', async () => {
    await set('sequence', 4, null);
    expect(prisma.sequence.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { thumbnailKey: null },
    });
  });

  it('refuse une clé qui pointe ailleurs — un autre type, une autre entité, un média', async () => {
    await expect(set('shot', 12, 'entity-thumbs/asset/12.jpg')).rejects.toThrow();
    await expect(set('shot', 12, 'entity-thumbs/shot/13.jpg')).rejects.toThrow();
    await expect(set('shot', 12, 'derived/99/thumbnail.webp')).rejects.toThrow();
    expect(prisma.shot.update).not.toHaveBeenCalled();
  });

  it('refuse un préfixe qui n’est qu’un début d’identifiant', async () => {
    // Sans le point final, « shot/1 » couvrirait « shot/12 », « shot/123 »…
    await expect(set('shot', 1, 'entity-thumbs/shot/12.jpg')).rejects.toThrow();
  });

  it('oublie l’URL mémorisée : remplacer une vignette réécrit le même objet', async () => {
    // Même entité, même extension ⇒ même clé. Sans cet oubli, l'URL présignée resterait
    // identique pendant toute la tranche et la carte afficherait l'ancienne image.
    await set('shot', 12, 'entity-thumbs/shot/12.jpg');
    expect(storage.forgetPresignedUrl).toHaveBeenCalledWith('entity-thumbs/shot/12.jpg');
  });

  it('n’oublie rien quand la clé est refusée ou effacée', async () => {
    await expect(set('shot', 12, 'derived/99/thumbnail.webp')).rejects.toThrow();
    await set('shot', 12, null);
    expect(storage.forgetPresignedUrl).not.toHaveBeenCalled();
  });
});
