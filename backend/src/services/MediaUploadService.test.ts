// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    mediaObject: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock('../lib/storage', () => ({
  storage: {
    abortMultipartUpload: vi.fn().mockResolvedValue(undefined),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    deletePrefix: vi.fn().mockResolvedValue(undefined),
    listUploadedParts: vi.fn().mockResolvedValue([]),
    createMultipartUpload: vi.fn().mockResolvedValue('up-new'),
    statObject: vi.fn().mockResolvedValue({ size: 0 }),
    copyObject: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('./MediaService', () => ({
  createUpload: vi.fn(),
  mediaSourceKey: vi.fn(),
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));

import { abortUpload, initMultipart, partSizeFor, MULTIPART_PART_SIZE } from './MediaUploadService';
import { createUpload } from './MediaService';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { Role } from '@prisma/client';

const findFirst = vi.mocked(prisma.mediaObject.findFirst);
const remove = vi.mocked(prisma.mediaObject.delete);
const abortMultipart = vi.mocked(storage.abortMultipartUpload);
const deleteObject = vi.mocked(storage.deleteObject);
const deletePrefix = vi.mocked(storage.deletePrefix);
const user = { id: 3, role: Role.ARTIST };

beforeEach(() => {
  vi.clearAllMocks();
});

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

describe('partSizeFor: multipart splitting', () => {
  it('keeps the 16 MB part as long as the file fits within a thousand parts', () => {
    expect(partSizeFor(20 * MB)).toBe(MULTIPART_PART_SIZE);
    expect(partSizeFor(8 * GB)).toBe(MULTIPART_PART_SIZE);
    // Exactly a thousand parts (15.6 GB): the limit is inclusive.
    expect(partSizeFor(MULTIPART_PART_SIZE * 1000)).toBe(MULTIPART_PART_SIZE);
  });

  it('enlarges the part beyond that, so that the 20 GB master stays under a thousand parts', () => {
    const size = 20 * GB;
    const part = partSizeFor(size);
    expect(part).toBeGreaterThan(MULTIPART_PART_SIZE);
    expect(part % MB).toBe(0); // a multiple of MB: readable and aligned
    expect(Math.ceil(size / part)).toBeLessThanOrEqual(1000);
  });

  it('remains deterministic: a resumption finds the same split', () => {
    expect(partSizeFor(37 * GB)).toBe(partSizeFor(37 * GB));
  });

  it('never goes below the S3 minimum of 5 MB', () => {
    expect(partSizeFor(1)).toBeGreaterThanOrEqual(5 * MB);
    expect(partSizeFor(200 * GB)).toBeGreaterThanOrEqual(5 * MB);
  });
});

describe('abortUpload: real cancellation on the server side', () => {
  it('abandons the multipart (the deposited parts cease to be billed) and deletes the row', async () => {
    findFirst.mockResolvedValue({
      id: 12,
      storageKey: 'media/12/source.mov',
      metadata: { multipartUploadId: 'up-1', multipartPartSize: MULTIPART_PART_SIZE },
    } as never);

    await expect(abortUpload(user, 12)).resolves.toEqual({ aborted: true });
    expect(abortMultipart).toHaveBeenCalledWith('media/12/source.mov', 'up-1');
    expect(deleteObject).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith({ where: { id: 12 } });
  });

  it('deletes the truncated object when the upload was a simple PUT (no multipart)', async () => {
    findFirst.mockResolvedValue({ id: 13, storageKey: 'media/13/source.png', metadata: {} } as never);

    await expect(abortUpload(user, 13)).resolves.toEqual({ aborted: true });
    expect(abortMultipart).not.toHaveBeenCalled();
    expect(deleteObject).toHaveBeenCalledWith('media/13/source.png');
    expect(remove).toHaveBeenCalledWith({ where: { id: 13 } });
  });

  it('deletes the row even if the storage refuses the abort (upload already expired)', async () => {
    findFirst.mockResolvedValue({
      id: 14,
      storageKey: 'media/14/source.mov',
      metadata: { multipartUploadId: 'up-gone' },
    } as never);
    abortMultipart.mockRejectedValueOnce(new Error('NoSuchUpload'));

    await expect(abortUpload(user, 14)).resolves.toEqual({ aborted: true });
    expect(remove).toHaveBeenCalledWith({ where: { id: 14 } });
  });

  it('empties the prefix of an abandoned sequence: 80 GB of frames do not remain billed', async () => {
    findFirst.mockResolvedValue({
      id: 15,
      storageKey: 'projects/demo/shots/sh0100/v01/15/sequence.json',
      metadata: {},
      imageSequence: { storagePrefix: 'projects/demo/shots/sh0100/v01/15/frames/' },
    } as never);

    await expect(abortUpload(user, 15)).resolves.toEqual({ aborted: true });
    expect(deletePrefix).toHaveBeenCalledWith('projects/demo/shots/sh0100/v01/15/frames/');
    expect(deleteObject).toHaveBeenCalledWith('projects/demo/shots/sh0100/v01/15/sequence.json');
    expect(abortMultipart).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith({ where: { id: 15 } });
  });

  it('refuses to cancel the upload of another account (the request already filters on uploaderId)', async () => {
    findFirst.mockResolvedValue(null);
    await expect(abortUpload(user, 99)).rejects.toThrow('Upload not found');
    expect(remove).not.toHaveBeenCalled();
  });
});

/**
 * INFRA-04, second hole. `listUploadedParts` also fails on a passing MinIO incident, while the multipart is
 * indeed still alive. The row gone, its `uploadId` is no longer anywhere: the parts already deposited become
 * invisible and permanent space.
 */
describe('initMultipart: resumption impossible', () => {
  it('abandons the multipart before throwing away the row its identifier depended on', async () => {
    findFirst.mockResolvedValueOnce({
      id: 31,
      storageKey: 'projects/demo/shots/sh0300/v02/31/master.mov',
      metadata: { multipartUploadId: 'up-orphan', multipartPartSize: MULTIPART_PART_SIZE },
    } as never);
    vi.mocked(storage.listUploadedParts).mockRejectedValueOnce(new Error('MinIO timeout'));
    // No twin to deduplicate: we fall back on the creation of a new upload.
    findFirst.mockResolvedValueOnce(null);
    vi.mocked(createUpload).mockResolvedValue({
      mediaObjectId: 32,
      storageKey: 'projects/demo/shots/sh0300/v02/32/master.mov',
      uploadUrl: 'https://minio.invalid/put',
      namingWarning: false,
      // Automatic publication (Phase 50): `createUpload` now returns the state at birth.
      published: true,
    });
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue({ metadata: {} } as never);
    remove.mockResolvedValue({} as never);
    vi.mocked(prisma.mediaObject.update).mockResolvedValue({} as never);

    const out = await initMultipart(user, {
      versionId: 5,
      kind: 'VIDEO',
      filename: 'master.mov',
      contentType: 'video/quicktime',
      contentHash: 'sha-abc',
      size: 40 * GB,
    } as never);

    expect(abortMultipart).toHaveBeenCalledWith('projects/demo/shots/sh0300/v02/31/master.mov', 'up-orphan');
    expect(remove).toHaveBeenCalledWith({ where: { id: 31 } });
    expect(out.mediaObjectId).toBe(32);
  });
});
