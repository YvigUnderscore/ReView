// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PERF-03: the cost of a batch's access check is measured in QUERIES, not by stopwatch.
 *
 * Before: each identifier went through a project resolver (1 to 3 queries depending on the domain), then
 * through `checkProjectAccess` (2 queries), and media through `assertMediaManage` (6). For the two hundred
 * identifiers the route allows, that made roughly a thousand sequential queries before the first write, all
 * returning the same project and the same membership. This file pins the number of calls, domain by domain.
 */
vi.mock('../lib/prisma', () => ({
  prisma: {
    project: { findMany: vi.fn() },
    episode: { findMany: vi.fn() },
    sequence: { findMany: vi.fn(), findUnique: vi.fn() },
    shot: { findMany: vi.fn(), updateMany: vi.fn() },
    asset: { findMany: vi.fn() },
    version: { findMany: vi.fn() },
    mediaObject: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
  },
}));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn() }));
vi.mock('../lib/projectRoles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/projectRoles')>()),
  effectiveProjectRole: vi.fn(),
}));
vi.mock('../lib/trash', () => ({
  softDeleteProjects: vi.fn(),
  softDeleteEpisodes: vi.fn(),
  softDeleteSequences: vi.fn(),
  softDeleteShots: vi.fn(),
  softDeleteAssets: vi.fn(),
  softDeleteVersions: vi.fn(),
  softDeleteMedias: vi.fn(),
  restoreProjects: vi.fn(),
  restoreEpisodes: vi.fn(),
  restoreSequences: vi.fn(),
  restoreShots: vi.fn(),
  restoreAssets: vi.fn(),
  restoreVersions: vi.fn(),
  restoreMedias: vi.fn(),
  purgeProjects: vi.fn(),
  purgeEpisodes: vi.fn(),
  purgeSequences: vi.fn(),
  purgeShots: vi.fn(),
  purgeAssets: vi.fn(),
  purgeVersions: vi.fn(),
  purgeMedias: vi.fn(),
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./MediaService', () => ({ assertMediaManage: vi.fn() }));
vi.mock('./TaskService', () => ({ update: vi.fn() }));
vi.mock('./VersionService', () => ({ update: vi.fn() }));
vi.mock('./DepartmentService', () => ({
  attachHolderDepartments: vi.fn(),
  detachHolderDepartments: vi.fn(),
}));
vi.mock('./ShotService', () => ({ update: vi.fn() }));

import { bulkDelete, bulkPatchTasks, bulkPatchVersions } from './BulkService';
import { prisma } from '../lib/prisma';
import { checkProjectAccess } from '../middleware/rbac';
import { effectiveProjectRole } from '../lib/projectRoles';
import { assertMediaManage } from './MediaService';
import { softDeleteMedias, softDeleteShots, softDeleteVersions } from '../lib/trash';
import { Role, VersionStatus } from '@prisma/client';

const admin = { id: 1, role: Role.ADMIN };
const artist = { id: 3, role: Role.ARTIST };

/** The two hundred identifiers that `routes/bulk.routes.ts` allows (`z.array(...).max(200)`). */
const ids = Array.from({ length: 200 }, (_, index) => index + 1);
const chain = { asset: null, task: { shot: { projectId: 7 }, asset: null } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkProjectAccess).mockResolvedValue(true);
  vi.mocked(effectiveProjectRole).mockResolvedValue(Role.ARTIST);
});

describe('batch access check: number of queries', () => {
  it('200 shots: one read, one project access check', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(ids.map((id) => ({ id, projectId: 7 })) as never);

    await bulkDelete(admin, 'shots', ids);

    expect(prisma.shot.findMany).toHaveBeenCalledTimes(1);
    expect(checkProjectAccess).toHaveBeenCalledTimes(1);
    expect(softDeleteShots).toHaveBeenCalledWith(ids);
  });

  it('200 versions: one read (author included), one project access check', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue(
      ids.map((id) => ({ id, authorId: 3, ...chain })) as never,
    );

    await bulkDelete(artist, 'versions', ids);

    // The author used to be re-read by an extra `version.findUnique`, one id at a time.
    expect(prisma.version.findMany).toHaveBeenCalledTimes(1);
    expect(checkProjectAccess).toHaveBeenCalledTimes(1);
    expect(softDeleteVersions).toHaveBeenCalledWith(ids);
  });

  it('200 media from the same project: one read and ONE MediaService guard', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue(
      ids.map((id) => ({ id, uploaderId: 3, version: chain })) as never,
    );

    await bulkDelete(artist, 'media', ids);

    expect(prisma.mediaObject.findMany).toHaveBeenCalledTimes(1);
    // Before: 200 calls, i.e. about 1,200 queries before the first write.
    expect(assertMediaManage).toHaveBeenCalledTimes(1);
    expect(effectiveProjectRole).toHaveBeenCalledTimes(1);
    expect(softDeleteMedias).toHaveBeenCalledWith(ids);
  });

  it('a selection spanning three projects: three checks, not two hundred', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(
      ids.map((id) => ({ id, projectId: 7 + (id % 3) })) as never,
    );

    await bulkDelete(admin, 'shots', ids);

    expect(checkProjectAccess).toHaveBeenCalledTimes(3);
  });

  it('200 tasks: a single resolution of the owning project', async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValue(
      ids.map((id) => ({ id, shot: { projectId: 7 }, asset: null })) as never,
    );

    await bulkPatchTasks(admin, ids, { status: undefined, assigneeId: 4 });

    expect(prisma.task.findMany).toHaveBeenCalledTimes(1);
  });

  it('200 versions to move to a status: a single resolution of the owning project', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue(
      ids.map((id) => ({ id, authorId: 3, ...chain })) as never,
    );

    await bulkPatchVersions(admin, ids, VersionStatus.REVIEW);

    expect(prisma.version.findMany).toHaveBeenCalledTimes(1);
  });
});
