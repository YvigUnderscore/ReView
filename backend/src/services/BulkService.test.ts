// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    version: { findUnique: vi.fn() },
    shot: { findMany: vi.fn(), updateMany: vi.fn() },
    sequence: { findUnique: vi.fn() },
  },
}));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn() }));
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForProject: vi.fn(),
  resolveProjectIdForSequence: vi.fn(),
  resolveProjectIdForShot: vi.fn(),
  resolveProjectIdForAsset: vi.fn(),
  resolveProjectIdForVersion: vi.fn(),
  resolveProjectIdForMedia: vi.fn(),
  resolveProjectIdForTask: vi.fn(),
}));
vi.mock('../lib/trash', () => ({
  softDeleteProjects: vi.fn(),
  softDeleteSequences: vi.fn(),
  softDeleteShots: vi.fn(),
  softDeleteAssets: vi.fn(),
  softDeleteVersions: vi.fn(),
  softDeleteMedias: vi.fn(),
  restoreProjects: vi.fn(),
  restoreSequences: vi.fn(),
  restoreShots: vi.fn(),
  restoreAssets: vi.fn(),
  restoreVersions: vi.fn(),
  restoreMedias: vi.fn(),
  purgeProject: vi.fn(),
  purgeSequence: vi.fn(),
  purgeShot: vi.fn(),
  purgeAsset: vi.fn(),
  purgeVersion: vi.fn(),
  purgeMedia: vi.fn(),
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./MediaService', () => ({ assertMediaManage: vi.fn() }));
vi.mock('./TaskService', () => ({ update: vi.fn() }));
vi.mock('./VersionService', () => ({ update: vi.fn() }));

import { bulkDelete, bulkMoveShots, bulkPurge } from './BulkService';
import { prisma } from '../lib/prisma';
import { checkProjectAccess } from '../middleware/rbac';
import {
  resolveProjectIdForProject,
  resolveProjectIdForSequence,
  resolveProjectIdForVersion,
} from '../lib/pipeline';
import { softDeleteSequences, softDeleteVersions, purgeProject } from '../lib/trash';
import { assertMediaManage } from './MediaService';
import { Role } from '@prisma/client';

const admin = { id: 1, role: Role.ADMIN };
const artist = { id: 3, role: Role.ARTIST };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkProjectAccess).mockResolvedValue(true);
  vi.mocked(resolveProjectIdForSequence).mockResolvedValue(7);
  vi.mocked(resolveProjectIdForVersion).mockResolvedValue(7);
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

  it('autorise l’auteur d’une version à la supprimer même sans être manager', async () => {
    vi.mocked(prisma.version.findUnique).mockResolvedValue({ authorId: 3 } as never);
    await bulkDelete(artist, 'versions', [9]);
    expect(softDeleteVersions).toHaveBeenCalledWith([9]);
  });

  it('refuse la suppression d’une version d’autrui à un non-manager', async () => {
    vi.mocked(prisma.version.findUnique).mockResolvedValue({ authorId: 99 } as never);
    await expect(bulkDelete(artist, 'versions', [9])).rejects.toMatchObject({ statusCode: 403 });
    expect(softDeleteVersions).not.toHaveBeenCalled();
  });

  it('délègue les médias à assertMediaManage pour chaque id', async () => {
    await bulkDelete(artist, 'media', [4, 5]);
    expect(assertMediaManage).toHaveBeenCalledTimes(2);
  });
});

describe('BulkService.bulkPurge — corbeille admin', () => {
  it('refuse la purge de projets à un artiste (non manager)', async () => {
    vi.mocked(resolveProjectIdForProject).mockResolvedValue(7);
    await expect(bulkPurge(artist, 'projects', [1, 2])).rejects.toMatchObject({ statusCode: 403 });
    expect(purgeProject).not.toHaveBeenCalled();
  });

  it('purge chaque projet sélectionné pour un admin', async () => {
    vi.mocked(resolveProjectIdForProject).mockResolvedValue(7);
    const n = await bulkPurge(admin, 'projects', [1, 2]);
    expect(n).toBe(2);
    expect(purgeProject).toHaveBeenCalledTimes(2);
    expect(purgeProject).toHaveBeenCalledWith(1);
    expect(purgeProject).toHaveBeenCalledWith(2);
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
