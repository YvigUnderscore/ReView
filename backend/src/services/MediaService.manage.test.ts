// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';

const { db } = vi.hoisted(() => ({
  db: {
    mediaObject: { findUnique: vi.fn() },
    // Version → Project resolution (`lib/pipeline`, left real).
    version: { findUnique: vi.fn() },
    // Role per project (38.E), read by `lib/projectRoles` — left real too: mocking the guard under test would
    // make the test blind to the A1-03 bypass.
    projectMembership: { findUnique: vi.fn() },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/storage', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('../lib/queues', () => ({ enqueueMediaJob: vi.fn(), enqueueSpatialThumb: vi.fn() }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/settings', () => ({ getNumericSetting: vi.fn(), getLiveSyncHz: vi.fn(), SETTING_KEYS: {} }));
vi.mock('../lib/trash', () => ({ softDeleteMedia: vi.fn(), restoreMedia: vi.fn(), purgeMedia: vi.fn() }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn() }));

import { assertMediaManage } from './MediaService';
import { checkProjectAccess } from '../middleware/rbac';

const PROJECT = 42;
/** Media uploaded by user 7 before their demotion. */
const OWN_MEDIA = { uploaderId: 7, versionId: 3 };
/** Media uploaded by someone else. */
const OTHER_MEDIA = { uploaderId: 99, versionId: 3 };

/** What `projectMembership.findUnique` must return for a given local role. */
const membership = (role: Role | null) => ({ userId: 7, projectId: PROJECT, role });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkProjectAccess).mockResolvedValue(true); // member: membership alone is not enough
  db.version.findUnique.mockResolvedValue({ asset: { projectId: PROJECT }, task: null });
  db.mediaObject.findUnique.mockResolvedValue(OWN_MEDIA);
  db.projectMembership.findUnique.mockResolvedValue(membership(null));
});

/**
 * A1-03 — `assertMediaManage` decided on the GLOBAL role (`user.role === ADMIN || SUPERVISOR`) after checking
 * only membership in the project. An ARTIST demoted to CLIENT (38.E) kept their `ProjectMembership`, so
 * `checkProjectAccess` said yes, and they kept trashing, reprocessing and retouching the media they had
 * uploaded. It is the front door of all media management: trash, reprocess, thumbnail, splat edits, USD
 * overrides, batch actions.
 */
describe('assertMediaManage: effective role per project (38.E)', () => {
  const artist = { id: 7, role: Role.ARTIST };

  it('lets the uploader manage their media as long as they contribute to the project', async () => {
    await expect(assertMediaManage(1, artist)).resolves.toEqual({ projectId: PROJECT, versionId: 3 });
  });

  it('refuses an ARTIST demoted to CLIENT, even on the media they uploaded', async () => {
    db.projectMembership.findUnique.mockResolvedValue(membership(Role.CLIENT));
    await expect(assertMediaManage(1, artist)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ROLE_FORBIDDEN',
    });
  });

  it("refuses someone else's media to a simple contributor", async () => {
    db.mediaObject.findUnique.mockResolvedValue(OTHER_MEDIA);
    await expect(assertMediaManage(1, artist)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("conversely: an ARTIST promoted to SUPERVISOR locally manages someone else's media", async () => {
    db.mediaObject.findUnique.mockResolvedValue(OTHER_MEDIA);
    db.projectMembership.findUnique.mockResolvedValue(membership(Role.SUPERVISOR));
    await expect(assertMediaManage(1, artist)).resolves.toEqual({ projectId: PROJECT, versionId: 3 });
  });

  it('a global ADMIN remains ADMIN everywhere, without membership', async () => {
    db.mediaObject.findUnique.mockResolvedValue(OTHER_MEDIA);
    db.projectMembership.findUnique.mockResolvedValue(null);
    await expect(assertMediaManage(1, { id: 1, role: Role.ADMIN })).resolves.toMatchObject({
      projectId: PROJECT,
    });
  });
});
