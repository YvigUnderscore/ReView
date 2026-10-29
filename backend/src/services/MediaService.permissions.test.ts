// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaKind, MediaStatus, Role } from '@prisma/client';

/**
 * The `permissions` block of the media detail (Phase 50, batch 6).
 *
 * The screen decided on its own whether to show the gizmos and the "Save" button of the "Clean" mode, on the
 * rule "unpublished version + internal role". The server additionally requires
 * the version's author or a project manager: an ARTIST member who is not the author therefore saw a button
 * refused afterwards with a 403. The detail now carries the server's answer, and it is
 * that which the viewer reads — this test exercises it on the real path of `getDetail`.
 */

const { db } = vi.hoisted(() => ({
  db: {
    mediaObject: { findUnique: vi.fn() },
    version: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    reviewReference: { findMany: vi.fn() },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn(() => Promise.resolve('https://minio.invalid/signed')) },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('./JobService', () => ({ enqueueMediaJob: vi.fn(), enqueueSpatialThumb: vi.fn() }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./WatchService', () => ({ notifyWatchers: vi.fn() }));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));
vi.mock('./ChatNotifyService', () => ({ notifyChat: vi.fn() }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('./ReviewAssignmentService', () => ({
  listReviewers: vi.fn(() => Promise.resolve([])),
  setReviewers: vi.fn(),
}));
vi.mock('../lib/mediaAccess', () => ({ logMediaAccess: vi.fn() }));
vi.mock('../lib/trash', () => ({ softDeleteMedia: vi.fn(), restoreMedia: vi.fn(), purgeMedia: vi.fn() }));
vi.mock('../lib/clamav', () => ({ isClamavEnabled: () => false }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../lib/projectRoles', () => ({ assertCanContribute: vi.fn(), isProjectManager: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectQuota', () => ({ assertProjectQuota: vi.fn() }));
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForVersion: vi.fn(() => Promise.resolve(PROJECT)),
  resolveStorageContextForVersion: vi.fn(),
}));
vi.mock('../lib/settings', () => ({
  getNumericSetting: vi.fn(),
  getLiveSyncHz: vi.fn(() => Promise.resolve(2)),
  isDraftModeEnabled: vi.fn(() => Promise.resolve(false)),
  SETTING_KEYS: {},
}));
// The delivery frame ratio: its inheritance chain has its own bench (`lib/deliveryAspect`).
vi.mock('../lib/deliveryAspect', () => ({ resolveDeliveryAspect: vi.fn(() => Promise.resolve(16 / 9)) }));
vi.mock('../lib/projectSettings', () => ({
  checkNaming: vi.fn(),
  resolveProjectSettingsById: vi.fn(() =>
    Promise.resolve({
      defaultLighting: null,
      color: null,
      reviewRequest: { requireNote: false, minNoteLength: 5 },
    }),
  ),
}));

import { getDetail } from './MediaService';
import { isProjectManager } from '../lib/projectRoles';

const PROJECT = 42;
const MEDIA_ID = 9;
const VERSION_ID = 3;
const AUTHOR = 7;
const OTHER = 8;

const media = {
  id: MEDIA_ID,
  kind: MediaKind.MODEL_3D,
  status: MediaStatus.READY,
  published: true,
  versionId: VERSION_ID,
  uploaderId: AUTHOR,
  originalName: 'sh0010_model_v001.usdz',
  storageKey: 'projects/p/sh/v/9/model.usdz',
  thumbnailKey: null,
  size: BigInt(1024),
  metadata: {},
};

/** Queries the detail on behalf of a user, with a given version. */
async function detailFor(opts: {
  userId: number;
  authorId: number | null;
  published: boolean;
  manager: boolean;
}) {
  db.mediaObject.findUnique.mockResolvedValue(media);
  db.version.findUnique.mockResolvedValue({ authorId: opts.authorId, published: opts.published });
  db.project.findUnique.mockResolvedValue({ startFrame: 1001 });
  db.reviewReference.findMany.mockResolvedValue([]);
  vi.mocked(isProjectManager).mockResolvedValue(opts.manager);
  const detail = await getDetail({ id: opts.userId, role: Role.ARTIST }, MEDIA_ID);
  return detail.permissions;
}

describe('getDetail — bloc permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('grants the transform to the author of an unpublished version', async () => {
    expect(await detailFor({ userId: AUTHOR, authorId: AUTHOR, published: false, manager: false })).toEqual({
      editTransform: true,
    });
  });

  it('grants it to the project manager who is not the author', async () => {
    expect(await detailFor({ userId: OTHER, authorId: AUTHOR, published: false, manager: true })).toEqual({
      editTransform: true,
    });
  });

  it('refuses it to the internal member who is neither author nor manager — it was the dead button', async () => {
    expect(await detailFor({ userId: OTHER, authorId: AUTHOR, published: false, manager: false })).toEqual({
      editTransform: false,
    });
  });

  it('refuses it as soon as the version is published, even to a manager', async () => {
    expect(await detailFor({ userId: OTHER, authorId: AUTHOR, published: true, manager: true })).toEqual({
      editTransform: false,
    });
  });

  it('queries the version of the media, and the effective role on ITS project', async () => {
    await detailFor({ userId: AUTHOR, authorId: AUTHOR, published: false, manager: false });
    expect(db.version.findUnique).toHaveBeenCalledWith({
      where: { id: VERSION_ID },
      select: { authorId: true, published: true },
    });
    expect(vi.mocked(isProjectManager)).toHaveBeenCalledWith(AUTHOR, Role.ARTIST, PROJECT);
  });
});
