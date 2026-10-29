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

vi.mock('../lib/storage', () => ({
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
import { storage } from '../lib/storage';

beforeEach(() => vi.clearAllMocks());

describe('resolveProject', () => {
  it('returns the carrying project, entity by entity', async () => {
    vi.mocked(prisma.sequence.findFirst).mockResolvedValue({ projectId: 7 } as never);
    vi.mocked(prisma.shot.findFirst).mockResolvedValue({ projectId: 8 } as never);
    vi.mocked(prisma.asset.findFirst).mockResolvedValue({ projectId: 9 } as never);
    await expect(resolveProject('sequence', 1)).resolves.toBe(7);
    await expect(resolveProject('shot', 1)).resolves.toBe(8);
    await expect(resolveProject('asset', 1)).resolves.toBe(9);
  });

  it('refuses an entity in the trash as an absent entity', async () => {
    vi.mocked(prisma.shot.findFirst).mockResolvedValue(null);
    await expect(resolveProject('shot', 1)).rejects.toThrow();
    // The trash is indeed in the filter, not only the identifier.
    expect(vi.mocked(prisma.shot.findFirst).mock.calls[0]![0]).toMatchObject({
      where: { id: 1, deletedAt: null },
    });
  });
});

describe('presign', () => {
  it('builds the key from the image type, without receiving anything from the client', async () => {
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

  it('rejects a type that is not a recognised image', async () => {
    await expect(presign('asset', 1, 'application/pdf')).rejects.toThrow();
    await expect(presign('asset', 1, 'image/gif')).rejects.toThrow();
  });
});

describe('set', () => {
  it('records a key that does designate the entity', async () => {
    await set('shot', 12, 'entity-thumbs/shot/12.jpg');
    expect(prisma.shot.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { thumbnailKey: 'entity-thumbs/shot/12.jpg' },
    });
  });

  it('clears the thumbnail: the entity falls back on the published media', async () => {
    await set('sequence', 4, null);
    expect(prisma.sequence.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { thumbnailKey: null },
    });
  });

  it('refuses a key pointing elsewhere — another type, another entity, a media', async () => {
    await expect(set('shot', 12, 'entity-thumbs/asset/12.jpg')).rejects.toThrow();
    await expect(set('shot', 12, 'entity-thumbs/shot/13.jpg')).rejects.toThrow();
    await expect(set('shot', 12, 'derived/99/thumbnail.webp')).rejects.toThrow();
    expect(prisma.shot.update).not.toHaveBeenCalled();
  });

  it('refuses a prefix that is only the start of an identifier', async () => {
    // Without the final dot, "shot/1" would cover "shot/12", "shot/123"…
    await expect(set('shot', 1, 'entity-thumbs/shot/12.jpg')).rejects.toThrow();
  });

  it('forgets the memoized URL: replacing a thumbnail rewrites the same object', async () => {
    // Same entity, same extension ⇒ same key. Without this forgetting, the presigned URL would remain
    // identical for the whole slice and the card would show the old image.
    await set('shot', 12, 'entity-thumbs/shot/12.jpg');
    expect(storage.forgetPresignedUrl).toHaveBeenCalledWith('entity-thumbs/shot/12.jpg');
  });

  it('forgets nothing when the key is refused or cleared', async () => {
    await expect(set('shot', 12, 'derived/99/thumbnail.webp')).rejects.toThrow();
    await set('shot', 12, null);
    expect(storage.forgetPresignedUrl).not.toHaveBeenCalled();
  });
});
