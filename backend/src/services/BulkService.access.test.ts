// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PERF-03 — le coût du contrôle d'accès d'un lot se mesure en REQUÊTES, pas au chronomètre.
 *
 * Avant : chaque identifiant repassait par un résolveur de projet (1 à 3 requêtes selon le
 * domaine) puis par `checkProjectAccess` (2 requêtes), et les médias par `assertMediaManage`
 * (6). Sur les deux cents identifiants que la route autorise, cela faisait un bon millier de
 * requêtes séquentielles avant la première écriture — toutes rendant le même projet et la
 * même appartenance. Ce fichier fige le nombre d'appels, domaine par domaine.
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

/** Les deux cents identifiants que `routes/bulk.routes.ts` autorise (`z.array(…).max(200)`). */
const ids = Array.from({ length: 200 }, (_, index) => index + 1);
const chain = { asset: null, task: { shot: { projectId: 7 }, asset: null } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkProjectAccess).mockResolvedValue(true);
  vi.mocked(effectiveProjectRole).mockResolvedValue(Role.ARTIST);
});

describe('contrôle d’accès d’un lot — nombre de requêtes', () => {
  it('200 plans : une lecture, un contrôle d’accès projet', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(ids.map((id) => ({ id, projectId: 7 })) as never);

    await bulkDelete(admin, 'shots', ids);

    expect(prisma.shot.findMany).toHaveBeenCalledTimes(1);
    expect(checkProjectAccess).toHaveBeenCalledTimes(1);
    expect(softDeleteShots).toHaveBeenCalledWith(ids);
  });

  it('200 versions : une lecture (auteur compris), un contrôle d’accès projet', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue(
      ids.map((id) => ({ id, authorId: 3, ...chain })) as never,
    );

    await bulkDelete(artist, 'versions', ids);

    // L'auteur était relu par un `version.findUnique` supplémentaire, id par id.
    expect(prisma.version.findMany).toHaveBeenCalledTimes(1);
    expect(checkProjectAccess).toHaveBeenCalledTimes(1);
    expect(softDeleteVersions).toHaveBeenCalledWith(ids);
  });

  it('200 médias d’un même projet : une lecture et UNE garde MediaService', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue(
      ids.map((id) => ({ id, uploaderId: 3, version: chain })) as never,
    );

    await bulkDelete(artist, 'media', ids);

    expect(prisma.mediaObject.findMany).toHaveBeenCalledTimes(1);
    // Avant : 200 appels, soit ~1 200 requêtes avant la première écriture.
    expect(assertMediaManage).toHaveBeenCalledTimes(1);
    expect(effectiveProjectRole).toHaveBeenCalledTimes(1);
    expect(softDeleteMedias).toHaveBeenCalledWith(ids);
  });

  it('une sélection à cheval sur trois projets : trois contrôles, pas deux cents', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(
      ids.map((id) => ({ id, projectId: 7 + (id % 3) })) as never,
    );

    await bulkDelete(admin, 'shots', ids);

    expect(checkProjectAccess).toHaveBeenCalledTimes(3);
  });

  it('200 tâches : une seule résolution du projet porteur', async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValue(
      ids.map((id) => ({ id, shot: { projectId: 7 }, asset: null })) as never,
    );

    await bulkPatchTasks(admin, ids, { status: undefined, assigneeId: 4 });

    expect(prisma.task.findMany).toHaveBeenCalledTimes(1);
  });

  it('200 versions à repasser en statut : une seule résolution du projet porteur', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue(
      ids.map((id) => ({ id, authorId: 3, ...chain })) as never,
    );

    await bulkPatchVersions(admin, ids, VersionStatus.REVIEW);

    expect(prisma.version.findMany).toHaveBeenCalledTimes(1);
  });
});
