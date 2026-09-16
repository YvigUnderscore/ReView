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
// Seule la lecture du rôle effectif est simulée : `canManageProject` reste la vraie règle.
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

/** Version rattachée au projet 7 par la chaîne task → shot, comme en base. */
const versionRow = (id: number, authorId: number) => ({
  id,
  authorId,
  asset: null,
  task: { shot: { projectId: 7 }, asset: null },
});

/** Média rattaché au projet 7 par la même chaîne. */
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

describe('BulkService.bulkDelete — RBAC par domaine', () => {
  it('refuse la suppression de séquences à un artiste (non manager)', async () => {
    await expect(bulkDelete(artist, 'sequences', [1, 2])).rejects.toMatchObject({ statusCode: 403 });
    expect(softDeleteSequences).not.toHaveBeenCalled();
  });

  it('autorise un admin à supprimer des séquences en lot', async () => {
    const n = await bulkDelete(admin, 'sequences', [1, 2, 3]);
    expect(n).toBe(3);
    expect(softDeleteSequences).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('refuse un id introuvable, sans rien modifier', async () => {
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([{ id: 1, projectId: 7 }] as never);
    await expect(bulkDelete(admin, 'sequences', [1, 404])).rejects.toMatchObject({ statusCode: 404 });
    expect(softDeleteSequences).not.toHaveBeenCalled();
  });

  it('autorise l’auteur d’une version à la supprimer même sans être manager', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([versionRow(9, 3)] as never);
    await bulkDelete(artist, 'versions', [9]);
    expect(softDeleteVersions).toHaveBeenCalledWith([9]);
  });

  it('refuse la suppression d’une version d’autrui à un non-manager', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([versionRow(9, 99)] as never);
    await expect(bulkDelete(artist, 'versions', [9])).rejects.toMatchObject({ statusCode: 403 });
    expect(softDeleteVersions).not.toHaveBeenCalled();
  });

  /**
   * La garde de `MediaService` reste l'autorité : elle est appelée pour chaque PROJET
   * rencontré, pas pour chaque identifiant — c'est exactement ce que le lot mutualise.
   * Ce qui dépend du média, lui, continue d'être vérifié un par un (cas suivants).
   */
  it('délègue les médias à assertMediaManage, une fois par projet', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([mediaRow(4, 3), mediaRow(5, 3)] as never);
    await bulkDelete(artist, 'media', [4, 5]);
    expect(assertMediaManage).toHaveBeenCalledTimes(1);
    expect(assertMediaManage).toHaveBeenCalledWith(4, artist);
  });

  it('appelle la garde pour chaque projet distinct de la sélection', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([mediaRow(4, 3, 7), mediaRow(5, 3, 8)] as never);
    await bulkDelete(artist, 'media', [4, 5]);
    expect(assertMediaManage).toHaveBeenCalledTimes(2);
    expect(assertMediaManage).toHaveBeenCalledWith(5, artist);
  });

  it('refuse un média déposé par quelqu’un d’autre à un non-manager du projet', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([mediaRow(4, 3), mediaRow(5, 99)] as never);
    await expect(bulkDelete(artist, 'media', [4, 5])).rejects.toMatchObject({ statusCode: 403 });
  });

  it('laisse un gérant du projet supprimer le média d’autrui', async () => {
    vi.mocked(effectiveProjectRole).mockResolvedValue(Role.SUPERVISOR);
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([mediaRow(4, 3), mediaRow(5, 99)] as never);
    await expect(bulkDelete(artist, 'media', [4, 5])).resolves.toBe(2);
  });

  it('refuse un média introuvable', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([mediaRow(4, 3)] as never);
    await expect(bulkDelete(artist, 'media', [4, 404])).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('BulkService.bulkPurge — corbeille admin', () => {
  it('refuse la purge de projets à un artiste (non manager)', async () => {
    await expect(bulkPurge(artist, 'projects', [1, 2])).rejects.toMatchObject({ statusCode: 403 });
    expect(purgeProjects).not.toHaveBeenCalled();
  });

  it('purge les projets sélectionnés en un seul lot pour un admin', async () => {
    const n = await bulkPurge(admin, 'projects', [1, 2]);
    expect(n).toBe(2);
    // Une passe pour toute la sélection, au lieu d'une purge unitaire bouclée.
    expect(purgeProjects).toHaveBeenCalledTimes(1);
    expect(purgeProjects).toHaveBeenCalledWith([1, 2]);
  });

  // La route unitaire `DELETE /api/projects/:projectId/purge` est réservée aux ADMIN.
  // La voie groupée ne demandait qu'un « gestionnaire » — donc aussi un SUPERVISOR, dont
  // l'accès projet est global : n'importe quel projet pouvait être détruit définitivement.
  it('refuse la purge d’un projet à un superviseur (réservée aux admins)', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: 1 }] as never);
    await expect(bulkPurge(supervisor, 'projects', [1])).rejects.toMatchObject({ statusCode: 403 });
    expect(purgeProjects).not.toHaveBeenCalled();
  });

  // La suppression douce (corbeille) reste bien ouverte au superviseur : seule la
  // destruction irréversible est remontée au niveau admin.
  it('laisse un superviseur mettre un projet à la corbeille', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: 1 }] as never);
    await expect(bulkDelete(supervisor, 'projects', [1])).resolves.toBe(1);
  });
});

describe('BulkService.bulkMoveShots', () => {
  it('refuse un non-manager', async () => {
    await expect(bulkMoveShots(artist, [1], 2)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuse des shots de projets différents', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue([
      { id: 1, projectId: 7 },
      { id: 2, projectId: 8 },
    ] as never);
    await expect(bulkMoveShots(admin, [1, 2], null)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('déplace des shots du même projet vers une séquence valide', async () => {
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
