// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A1-06: project access is rechecked at the moment of the action.
 *
 * `add` only checked ownership of the comment: a contractor removed from a finished project replayed
 * one of their old `commentId` values and still stored an image in the studio bucket. Ownership of a
 * comment says what happened, not what is allowed now.
 */
vi.mock('../lib/prisma', () => ({
  prisma: {
    comment: { findUnique: vi.fn() },
    reviewReference: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

const { putObject, presign, access, writable, resolveMedia } = vi.hoisted(() => ({
  putObject: vi.fn(),
  presign: vi.fn(),
  access: vi.fn(),
  writable: vi.fn(),
  resolveMedia: vi.fn(),
}));

vi.mock('./StorageService', () => ({
  storage: { putObject, getPresignedGetUrl: presign, deleteObject: vi.fn() },
}));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: access }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: writable }));
vi.mock('../lib/pipeline', () => ({ resolveProjectIdForMedia: resolveMedia }));
vi.mock('./MediaService', () => ({ assertMediaManage: vi.fn() }));

import { add } from './ReviewReferenceService';
import { prisma } from '../lib/prisma';
import { Role } from '@prisma/client';
import { forbidden } from '../lib/errors';

const author = { id: 12, role: Role.ARTIST };
// 1x1 PNG: enough to pass the signature check.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

beforeEach(() => {
  vi.clearAllMocks();
  resolveMedia.mockResolvedValue(3);
  access.mockResolvedValue(true);
  writable.mockResolvedValue(undefined);
  presign.mockResolvedValue('https://minio/ref');
  vi.mocked(prisma.comment.findUnique).mockResolvedValue({ mediaObjectId: 5, userId: author.id } as never);
  vi.mocked(prisma.reviewReference.count).mockResolvedValue(0);
  vi.mocked(prisma.reviewReference.create).mockResolvedValue({
    id: 1,
    storageKey: 'derived/5/reference-x.png',
    x: 0,
    y: 0,
    width: 0.3,
    commentId: 9,
  } as never);
});

describe('ReviewReferenceService.add: project access (A1-06)', () => {
  it("refuses the comment author who is no longer a project member, without storing anything", async () => {
    access.mockResolvedValue(false);
    await expect(add(author, 5, PNG, 9)).rejects.toThrow(/No access/);
    expect(putObject).not.toHaveBeenCalled();
    expect(prisma.reviewReference.create).not.toHaveBeenCalled();
  });

  it('refuses on an archived or trashed project, without storing anything', async () => {
    writable.mockRejectedValue(forbidden('Archived project — read only', 'PROJECT_ARCHIVED'));
    await expect(add(author, 5, PNG, 9)).rejects.toThrow(/Archived/);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('refuses an unknown media before reading the comment', async () => {
    resolveMedia.mockResolvedValue(null);
    await expect(add(author, 5, PNG, 9)).rejects.toThrow(/Media not found/);
    expect(prisma.comment.findUnique).not.toHaveBeenCalled();
  });

  it('lets through a member who authored the comment', async () => {
    const ref = await add(author, 5, PNG, 9);
    expect(access).toHaveBeenCalledWith(author.id, author.role, 3);
    expect(putObject).toHaveBeenCalled();
    expect(ref.url).toBe('https://minio/ref');
  });
});
