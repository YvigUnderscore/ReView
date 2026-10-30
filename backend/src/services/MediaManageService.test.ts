// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: { mediaObject: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
  storage: { putObject: vi.fn(), getPresignedGetUrl: vi.fn(), deleteObject: vi.fn() },
  checkProjectAccess: vi.fn(),
  resolveProjectIdForVersion: vi.fn(),
  assertCanContribute: vi.fn(),
  isProjectManager: vi.fn(),
  trash: { softDeleteMedia: vi.fn(), restoreMedia: vi.fn(), purgeMedia: vi.fn() },
  logAudit: vi.fn(),
  emitToProject: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: h.db }));
vi.mock('../lib/storage', () => ({
  storage: h.storage,
  StorageService: { thumbnailKey: (id: number, ext: string) => `derived/${id}/thumbnail.${ext}` },
}));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: h.checkProjectAccess }));
vi.mock('../lib/pipeline', () => ({ resolveProjectIdForVersion: h.resolveProjectIdForVersion }));
vi.mock('../lib/projectRoles', () => ({
  assertCanContribute: h.assertCanContribute,
  isProjectManager: h.isProjectManager,
}));
vi.mock('../lib/trash', () => h.trash);
vi.mock('./AuditService', () => ({ logAudit: h.logAudit }));
vi.mock('./SocketService', () => ({ emitToProject: h.emitToProject }));

import {
  assertMediaManage,
  purge,
  restore,
  setAutoThumbnail,
  setThumbnail,
  trash,
} from './MediaManageService';

const artist = { id: 7, role: 'ARTIST' as const };
const supervisor = { id: 2, role: 'SUPERVISOR' as const };
// A real 1×1 PNG: the signature check reads the magic bytes.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeEach(() => {
  vi.clearAllMocks();
  h.db.mediaObject.findUnique.mockResolvedValue({
    uploaderId: 7,
    versionId: 30,
    published: true,
    thumbnailKey: null,
  });
  h.resolveProjectIdForVersion.mockResolvedValue(3);
  h.checkProjectAccess.mockResolvedValue(true);
  h.isProjectManager.mockResolvedValue(false);
  h.storage.getPresignedGetUrl.mockImplementation(async (key: string) => `https://s3/${key}`);
  h.db.mediaObject.updateMany.mockResolvedValue({ count: 1 });
});

describe('assertMediaManage', () => {
  it('lets the uploader and a project manager manage, nobody else', async () => {
    await expect(assertMediaManage(1, artist)).resolves.toEqual({ projectId: 3, versionId: 30 });
    h.isProjectManager.mockResolvedValue(true);
    await expect(assertMediaManage(1, supervisor)).resolves.toEqual({ projectId: 3, versionId: 30 });
    h.isProjectManager.mockResolvedValue(false);
    await expect(assertMediaManage(1, { id: 99, role: 'ARTIST' })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('an unknown media is a 404, a foreign project a 403', async () => {
    h.db.mediaObject.findUnique.mockResolvedValueOnce(null);
    await expect(assertMediaManage(1, artist)).rejects.toMatchObject({ statusCode: 404 });
    h.checkProjectAccess.mockResolvedValueOnce(false);
    await expect(assertMediaManage(1, artist)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('setThumbnail', () => {
  it('stores a validated image and returns its URL', async () => {
    const out = await setThumbnail(artist, 1, PNG);
    expect(h.storage.putObject).toHaveBeenCalledWith(
      'derived/1/thumbnail.png',
      expect.any(Buffer),
      'image/png',
    );
    expect(h.db.mediaObject.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { thumbnailKey: 'derived/1/thumbnail.png' },
    });
    expect(out).toEqual({ thumbnailUrl: 'https://s3/derived/1/thumbnail.png' });
  });

  it.each([
    ['not a data URL', 'hello'],
    ['an empty image', 'data:image/jpeg;base64,'],
    [
      'bytes that are not an image',
      `data:image/webp;base64,${Buffer.from('not an image at all').toString('base64')}`,
    ],
  ])('refuses %s', async (_label, dataUrl) => {
    await expect(setThumbnail(artist, 1, dataUrl)).rejects.toMatchObject({ code: 'INVALID_THUMBNAIL' });
    expect(h.storage.putObject).not.toHaveBeenCalled();
  });
});

describe('setAutoThumbnail', () => {
  it('fills a missing preview once', async () => {
    expect(await setAutoThumbnail(artist, 1, PNG)).toEqual({
      thumbnailUrl: 'https://s3/derived/1/thumbnail.png',
      created: true,
    });
    expect(h.db.mediaObject.updateMany).toHaveBeenCalledWith({
      where: { id: 1, thumbnailKey: null },
      data: { thumbnailKey: 'derived/1/thumbnail.png' },
    });
  });

  it('never overwrites an existing thumbnail', async () => {
    h.db.mediaObject.findUnique.mockResolvedValue({
      published: true,
      uploaderId: 7,
      versionId: 30,
      thumbnailKey: 'k',
    });
    expect(await setAutoThumbnail(artist, 1, PNG)).toEqual({ thumbnailUrl: 'https://s3/k', created: false });
    expect(h.storage.putObject).not.toHaveBeenCalled();
  });

  it('a concurrent capture wins: our object is removed and theirs returned', async () => {
    h.db.mediaObject.updateMany.mockResolvedValue({ count: 0 });
    h.db.mediaObject.findUnique
      .mockResolvedValueOnce({ published: true, uploaderId: 7, versionId: 30, thumbnailKey: null })
      .mockResolvedValueOnce({ thumbnailKey: 'theirs' });
    h.storage.deleteObject.mockResolvedValue(undefined);
    expect(await setAutoThumbnail(artist, 1, PNG)).toEqual({
      thumbnailUrl: 'https://s3/theirs',
      created: false,
    });
    expect(h.storage.deleteObject).toHaveBeenCalledWith('derived/1/thumbnail.png');
  });

  it('a draft is invisible to anyone but its uploader, a foreign project is refused', async () => {
    h.db.mediaObject.findUnique.mockResolvedValue({
      published: false,
      uploaderId: 7,
      versionId: 30,
      thumbnailKey: null,
    });
    await expect(setAutoThumbnail({ id: 8, role: 'ARTIST' }, 1, PNG)).rejects.toMatchObject({
      statusCode: 404,
    });
    h.db.mediaObject.findUnique.mockResolvedValue({
      published: true,
      uploaderId: 7,
      versionId: 30,
      thumbnailKey: null,
    });
    h.checkProjectAccess.mockResolvedValue(false);
    await expect(setAutoThumbnail(artist, 1, PNG)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('trash, restore, purge', () => {
  it('trash and restore go through the trash helpers and notify the project', async () => {
    await trash(artist, 1);
    expect(h.trash.softDeleteMedia).toHaveBeenCalledWith(1);
    expect(h.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'MEDIA_DELETE' }));
    await restore(artist, 1);
    expect(h.trash.restoreMedia).toHaveBeenCalledWith(1);
    expect(h.emitToProject).toHaveBeenCalledWith(3, 'media:update', { projectId: 3, id: 1, versionId: 30 });
  });

  it('purge is reserved to supervisors and administrators', async () => {
    await expect(purge(artist, 1)).rejects.toMatchObject({ statusCode: 403 });
    h.isProjectManager.mockResolvedValue(true);
    await purge(supervisor, 1);
    expect(h.trash.purgeMedia).toHaveBeenCalledWith(1);
    expect(h.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'MEDIA_PURGE' }));
  });
});
