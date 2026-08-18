// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    playlist: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    playlistItem: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    mediaObject: { findMany: vi.fn() },
    version: { findMany: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  },
}));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn(async (k: string) => `https://minio/${k}`) },
}));

import { create, addItems, reorder, rename, removeItem, remove, getDetail } from './PlaylistService';
import { prisma } from '../lib/prisma';

const artist = { id: 10, role: 'ARTIST' } as never;
const supervisor = { id: 99, role: 'SUPERVISOR' } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('create (33.A)', () => {
  it('résout mediaIds → versions, dédoublonne et ordonne les items initiaux', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([
      { versionId: 5 },
      { versionId: 6 },
      { versionId: 5 },
    ] as never);
    vi.mocked(prisma.version.findMany).mockResolvedValue([{ id: 5 }, { id: 6 }] as never);
    vi.mocked(prisma.playlist.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.playlist.create).mockResolvedValue({ id: 7, projectId: 2 } as never);
    await create(artist, 2, 'Dailies lundi', [], [101, 102, 103]);
    expect(prisma.playlist.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 2,
          name: 'Dailies lundi',
          createdById: 10,
          items: {
            create: [
              { versionId: 5, order: 0 },
              { versionId: 6, order: 1 },
            ],
          },
        }),
      }),
    );
  });

  it('refuse une version hors du projet de la playlist', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([{ id: 5 }] as never);
    vi.mocked(prisma.playlist.findUnique).mockResolvedValue(null);
    await expect(create(artist, 2, 'X', [5, 6])).rejects.toThrow(/n’appartiennent pas au projet/);
  });

  it('refuse un doublon de nom dans le projet (409)', async () => {
    vi.mocked(prisma.playlist.findUnique).mockResolvedValue({ id: 1 } as never);
    await expect(create(artist, 2, 'Dailies')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('addItems (33.A)', () => {
  beforeEach(() => {
    vi.mocked(prisma.playlist.findUnique).mockResolvedValue({
      id: 1,
      projectId: 2,
      createdById: 10,
    } as never);
  });

  it('ajoute en fin, en sautant les versions déjà présentes', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([{ id: 5 }, { id: 7 }] as never);
    vi.mocked(prisma.playlistItem.findMany).mockResolvedValue([
      { versionId: 5, order: 0 },
      { versionId: 6, order: 1 },
    ] as never);
    const out = await addItems(artist, 1, [5, 7]);
    expect(out).toEqual({ added: 1, skipped: 1 });
    expect(prisma.playlistItem.create).toHaveBeenCalledTimes(1);
    expect(prisma.playlistItem.create).toHaveBeenCalledWith({
      data: { playlistId: 1, versionId: 7, order: 2 },
    });
  });

  it('refuse un non-créateur non superviseur', async () => {
    await expect(addItems({ id: 55, role: 'ARTIST' } as never, 1, [5])).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('accepte un superviseur non créateur', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([{ id: 5 }] as never);
    vi.mocked(prisma.playlistItem.findMany).mockResolvedValue([] as never);
    const out = await addItems(supervisor, 1, [5]);
    expect(out.added).toBe(1);
  });
});

describe('reorder (33.A)', () => {
  beforeEach(() => {
    vi.mocked(prisma.playlist.findUnique).mockResolvedValue({
      id: 1,
      projectId: 2,
      createdById: 10,
    } as never);
    vi.mocked(prisma.playlistItem.findMany).mockResolvedValue([{ id: 11 }, { id: 12 }, { id: 13 }] as never);
  });

  it('réécrit order selon le nouvel ordre complet', async () => {
    await reorder(artist, 1, [13, 11, 12]);
    expect(prisma.playlistItem.update).toHaveBeenCalledWith({ where: { id: 13 }, data: { order: 0 } });
    expect(prisma.playlistItem.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { order: 1 } });
    expect(prisma.playlistItem.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { order: 2 } });
  });

  it('accepte un ordre partiel : les items non cités suivent, dans leur ordre', async () => {
    // Le cas qui bloquait tout : le détail masque les versions en corbeille, donc l'écran
    // renvoyait moins d'items qu'il n'en existe — et réordonner devenait impossible.
    await reorder(artist, 1, [13, 11]);
    expect(prisma.playlistItem.update).toHaveBeenCalledWith({ where: { id: 13 }, data: { order: 0 } });
    expect(prisma.playlistItem.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { order: 1 } });
    expect(prisma.playlistItem.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { order: 2 } });
  });

  it('refuse un item étranger à la playlist', async () => {
    await expect(reorder(artist, 1, [13, 11, 99])).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('rename / removeItem / remove (33.A)', () => {
  beforeEach(() => {
    vi.mocked(prisma.playlist.findUnique).mockResolvedValue({
      id: 1,
      projectId: 2,
      createdById: 10,
    } as never);
  });

  it('rename refuse un doublon de nom', async () => {
    vi.mocked(prisma.playlist.findUnique)
      .mockResolvedValueOnce({ id: 1, projectId: 2, createdById: 10 } as never)
      .mockResolvedValueOnce({ id: 3 } as never);
    await expect(rename(artist, 1, 'Autre')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('removeItem : 404 si l’item n’est pas dans la playlist', async () => {
    vi.mocked(prisma.playlistItem.deleteMany).mockResolvedValue({ count: 0 });
    await expect(removeItem(artist, 1, 42)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('remove supprime la playlist (créateur)', async () => {
    await remove(artist, 1);
    expect(prisma.playlist.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});

describe('getDetail (33.A)', () => {
  it('items ordonnés : localisation lisible, premier média visible presigné, versions corbeille exclues', async () => {
    vi.mocked(prisma.playlist.findUnique).mockResolvedValue({
      id: 1,
      projectId: 2,
      name: 'Dailies',
      createdBy: { id: 10, name: 'Alice' },
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          id: 11,
          order: 0,
          version: {
            id: 5,
            name: 'V02',
            deletedAt: null,
            reviewStatus: null,
            task: { name: 'Comp', shot: { code: 'SH010', sequence: { code: 'SQ001' } }, asset: null },
            asset: null,
            media: [
              { id: 71, kind: 'VIDEO', originalName: 'sh010.mov', thumbnailKey: 'thumb/71.jpg' },
              { id: 72, kind: 'VIDEO', originalName: 'alt.mov', thumbnailKey: null },
            ],
          },
        },
        {
          id: 12,
          order: 1,
          version: {
            id: 6,
            name: 'V01',
            deletedAt: new Date(),
            reviewStatus: null,
            task: null,
            asset: null,
            media: [],
          },
        },
      ],
    } as never);
    const out = await getDetail(artist, 1);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      id: 11,
      version: { id: 5, location: 'SQ001 · SH010 › Comp', mediaCount: 2 },
      media: { id: 71, thumbnailUrl: 'https://minio/thumb/71.jpg' },
    });
  });
});
