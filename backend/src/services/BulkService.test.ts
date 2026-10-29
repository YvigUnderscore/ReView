// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
// Only the read of the effective role is simulated: `canManageProject` remains the real rule.
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

import { bulkDelete, bulkMoveShots, bulkPurge } from './BulkService';
import { prisma } from '../lib/prisma';
import { checkProjectAccess } from '../middleware/rbac';
import { effectiveProjectRole } from '../lib/projectRoles';
import { softDeleteSequences, softDeleteVersions, purgeProjects } from '../lib/trash';
import { assertMediaManage } from './MediaService';
import { Role } from '@prisma/client';

const admin = { id: 1, role: Role.ADMIN };
const artist = { id: 3, role: Role.ARTIST };
const supervisor = { id: 5, role: Role.SUPERVISOR };

/** Version attached to project 7 through the task -> shot chain, as in the database. */
const versionRow = (id: number, authorId: number) => ({
  id,
  authorId,
  asset: null,
  task: { shot: { projectId: 7 }, asset: null },
});

/** Media attached to project 7 through the same chain. */
const mediaRow = (id: number, uploaderId: number | null, projectId = 7) => ({
  id,
  uploaderId,
  version: { asset: null, task: { shot: { projectId }, asset: null } },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkProjectAccess).mockResolvedValue(true);
  vi.mocked(effectiveProjectRole).mockResolvedValue(Role.ARTIST);
  vi.mocked(prisma.sequence.findMany).mockResolvedValue([
    { id: 1, projectId: 7 },
    { id: 2, projectId: 7 },
    { id: 3, projectId: 7 },
  ] as never);
  vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
});

describe('BulkService.bulkDelete: RBAC per domain', () => {
  it('refuses deleting sequences to an artist (non-manager)', async () => {
    await expect(bulkDelete(artist, 'sequences', [1, 2])).rejects.toMatchObject({ statusCode: 403 });
    expect(softDeleteSequences).not.toHaveBeenCalled();
  });

  it('lets an admin delete sequences in bulk', async () => {
    const n = await bulkDelete(admin, 'sequences', [1, 2, 3]);
    expect(n).toBe(3);
    expect(softDeleteSequences).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('refuses an unknown id, changing nothing', async () => {
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([{ id: 1, projectId: 7 }] as never);
    await expect(bulkDelete(admin, 'sequences', [1, 404])).rejects.toMatchObject({ statusCode: 404 });
    expect(softDeleteSequences).not.toHaveBeenCalled();
  });

  it('lets the author of a version delete it even without being a manager', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([versionRow(9, 3)] as never);
    await bulkDelete(artist, 'versions', [9]);
    expect(softDeleteVersions).toHaveBeenCalledWith([9]);
  });

  it("refuses deleting someone else's version to a non-manager", async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([versionRow(9, 99)] as never);
    await expect(bulkDelete(artist, 'versions', [9])).rejects.toMatchObject({ statusCode: 403 });
    expect(softDeleteVersions).not.toHaveBeenCalled();
  });

  /**
   * The `MediaService` guard remains the authority: it is called for each PROJECT encountered, not for each
   * identifier, which is exactly what the batch pools. What depends on the media itself is still checked one
   * by one (following cases).
   */
  it('delegates media to assertMediaManage, once per project', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([mediaRow(4, 3), mediaRow(5, 3)] as never);
    await bulkDelete(artist, 'media', [4, 5]);
    expect(assertMediaManage).toHaveBeenCalledTimes(1);
    expect(assertMediaManage).toHaveBeenCalledWith(4, artist);
  });

  it('calls the guard for each distinct project in the selection', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([mediaRow(4, 3, 7), mediaRow(5, 3, 8)] as never);
    await bulkDelete(artist, 'media', [4, 5]);
    expect(assertMediaManage).toHaveBeenCalledTimes(2);
    expect(assertMediaManage).toHaveBeenCalledWith(5, artist);
  });

  it('refuses a media uploaded by someone else to a non-manager of the project', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([mediaRow(4, 3), mediaRow(5, 99)] as never);
    await expect(bulkDelete(artist, 'media', [4, 5])).rejects.toMatchObject({ statusCode: 403 });
  });

  it("lets a project manager delete someone else's media", async () => {
    vi.mocked(effectiveProjectRole).mockResolvedValue(Role.SUPERVISOR);
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([mediaRow(4, 3), mediaRow(5, 99)] as never);
    await expect(bulkDelete(artist, 'media', [4, 5])).resolves.toBe(2);
  });

  it('refuses an unknown media', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([mediaRow(4, 3)] as never);
    await expect(bulkDelete(artist, 'media', [4, 404])).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('BulkService.bulkPurge: admin trash', () => {
  it('refuses purging projects to an artist (non-manager)', async () => {
    await expect(bulkPurge(artist, 'projects', [1, 2])).rejects.toMatchObject({ statusCode: 403 });
    expect(purgeProjects).not.toHaveBeenCalled();
  });

  it('purges the selected projects in a single batch for an admin', async () => {
    const n = await bulkPurge(admin, 'projects', [1, 2]);
    expect(n).toBe(2);
    // One pass for the whole selection, instead of a looped single purge.
    expect(purgeProjects).toHaveBeenCalledTimes(1);
    expect(purgeProjects).toHaveBeenCalledWith([1, 2]);
  });

  // The single route `DELETE /api/projects/:projectId/purge` is reserved to ADMIN. The batch path only asked
  // for a "manager", which includes SUPERVISOR, whose project access is global: any project could be
  // destroyed permanently.
  it('refuses purging a project to a supervisor (reserved to admins)', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: 1 }] as never);
    await expect(bulkPurge(supervisor, 'projects', [1])).rejects.toMatchObject({ statusCode: 403 });
    expect(purgeProjects).not.toHaveBeenCalled();
  });

  // Soft deletion (trash) remains open to the supervisor: only the irreversible destruction is raised to
  // admin level.
  it('lets a supervisor move a project to the trash', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: 1 }] as never);
    await expect(bulkDelete(supervisor, 'projects', [1])).resolves.toBe(1);
  });
});

describe('BulkService.bulkMoveShots', () => {
  it('refuses a non-manager', async () => {
    await expect(bulkMoveShots(artist, [1], 2)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses shots from different projects', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue([
      { id: 1, projectId: 7 },
      { id: 2, projectId: 8 },
    ] as never);
    await expect(bulkMoveShots(admin, [1, 2], null)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('moves shots of the same project into a valid sequence', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue([
      { id: 1, projectId: 7 },
      { id: 2, projectId: 7 },
    ] as never);
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue({ projectId: 7 } as never);
    const n = await bulkMoveShots(admin, [1, 2], 5);
    expect(n).toBe(2);
    expect(prisma.shot.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
      data: { sequenceId: 5 },
    });
  });
});
