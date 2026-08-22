// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `version.published` est l'événement auquel s'abonne d'abord un studio, et il ne partait
 * que de la route v1 : publier depuis l'interface, par un patch en lot ou par « publier
 * tout » ne réveillait aucun abonné. Ces tests figent l'émission depuis le service et le
 * fait qu'elle suit une transition — repasser publié sur une version publiée n'est pas
 * une publication.
 */
vi.mock('../lib/prisma', () => ({
  prisma: {
    version: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(() => Promise.resolve([])),
    },
    mediaObject: { findMany: vi.fn(() => Promise.resolve([])) },
    project: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    shotgridConnection: { findUnique: vi.fn() },
    task: { findUnique: vi.fn() },
    asset: { findUnique: vi.fn() },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));
vi.mock('./StorageService', () => ({ storage: { getPresignedGetUrl: vi.fn() } }));
vi.mock('./MediaService', () => ({ publish: vi.fn(), syncVersionPublication: vi.fn() }));
vi.mock('../lib/trash', () => ({
  softDeleteVersion: vi.fn(),
  restoreVersion: vi.fn(),
  purgeVersion: vi.fn(),
}));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('../lib/projectRoles', () => ({
  assertCanContribute: vi.fn(),
  assertProjectManage: vi.fn(),
  isProjectManager: vi.fn(() => Promise.resolve(true)),
}));

import { create, publishAll, update } from './VersionService';
import { prisma } from '../lib/prisma';
import { publish } from './ApiEventService';
import { Role, VersionStatus } from '@prisma/client';

const supervisor = { id: 2, role: Role.SUPERVISOR };

/** Ligne au format `versionSelect`. */
const versionRow = {
  id: 5,
  name: 'sh010_comp_v003',
  status: VersionStatus.PUBLISHED,
  published: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  author: null,
  reviewStatus: null,
  task: null,
  asset: null,
};

const eventsSent = () => vi.mocked(publish).mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VersionService.update — publication depuis l’interface', () => {
  it('publie version.published sur la transition', async () => {
    vi.mocked(prisma.version.findUnique)
      .mockResolvedValueOnce({ authorId: 2, published: false } as never)
      .mockResolvedValueOnce(versionRow as never);
    vi.mocked(prisma.version.update).mockResolvedValue({ id: 5, published: true } as never);

    await update(supervisor, 3, 5, { status: VersionStatus.PUBLISHED });

    expect(eventsSent()).toEqual(['version.published']);
    expect(vi.mocked(publish).mock.calls[0]![1]).toMatchObject({
      projectId: 3,
      entityType: 'version',
      entityId: 5,
      actorId: 2,
    });
  });

  it('ne republie pas une version déjà publiée', async () => {
    vi.mocked(prisma.version.findUnique).mockResolvedValueOnce({ authorId: 2, published: true } as never);
    vi.mocked(prisma.version.update).mockResolvedValue({ id: 5, published: true } as never);

    await update(supervisor, 3, 5, { status: VersionStatus.PUBLISHED });

    expect(publish).not.toHaveBeenCalled();
  });

  it('reste muet pour un simple renommage', async () => {
    vi.mocked(prisma.version.findUnique).mockResolvedValueOnce({ authorId: 2, published: false } as never);
    vi.mocked(prisma.version.update).mockResolvedValue({ id: 5, published: false } as never);

    await update(supervisor, 3, 5, { name: 'sh010_comp_v004' });

    expect(publish).not.toHaveBeenCalled();
  });
});

describe('VersionService.publishAll — « publier tout »', () => {
  it('publie version.published quand la version bascule', async () => {
    vi.mocked(prisma.version.findUnique)
      .mockResolvedValueOnce({ id: 5, deletedAt: null, published: false } as never)
      .mockResolvedValueOnce(versionRow as never);
    vi.mocked(prisma.version.findUniqueOrThrow).mockResolvedValue({ id: 5, published: true } as never);

    await publishAll(supervisor, 3, 5);

    expect(eventsSent()).toEqual(['version.published']);
  });

  it('reste muet si la version était déjà publiée', async () => {
    vi.mocked(prisma.version.findUnique).mockResolvedValueOnce({
      id: 5,
      deletedAt: null,
      published: true,
    } as never);
    vi.mocked(prisma.version.findUniqueOrThrow).mockResolvedValue({ id: 5, published: true } as never);

    await publishAll(supervisor, 3, 5);

    expect(publish).not.toHaveBeenCalled();
  });
});

describe('VersionService.create', () => {
  it('publie version.created', async () => {
    vi.mocked(prisma.version.create).mockResolvedValue({ id: 5, taskId: 1, assetId: null } as never);
    vi.mocked(prisma.version.findUnique).mockResolvedValueOnce(versionRow as never);

    await create(supervisor, 3, { taskId: 1, name: 'sh010_comp_v003' });

    expect(eventsSent()).toEqual(['version.created']);
  });
});
