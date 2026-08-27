// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { project: { findMany: vi.fn(), count: vi.fn() }, $queryRaw: vi.fn() },
}));
// La requête groupée elle-même (`DISTINCT ON`) vit dans `lib/thumbnails` et y est testée :
// ce fichier vérifie ce que la liste en fait — une passe pour la page, et la bonne clé de
// repli attribuée au bon projet.
vi.mock('../lib/thumbnails', () => ({
  effectiveThumbnailUrl: vi.fn().mockResolvedValue(null),
  firstMediaThumbKeysForProjects: vi.fn().mockResolvedValue(new Map()),
}));

import { listProjects } from './ProjectService';
import { prisma } from '../lib/prisma';
import { effectiveThumbnailUrl, firstMediaThumbKeysForProjects } from '../lib/thumbnails';
import { Role } from '@prisma/client';

const findMany = vi.mocked(prisma.project.findMany);
const count = vi.mocked(prisma.project.count);
const queryRaw = vi.mocked(prisma.$queryRaw);
const thumbKeys = vi.mocked(firstMediaThumbKeysForProjects);
const admin = { id: 1, role: Role.ADMIN };
const client = { id: 9, role: Role.CLIENT };
const page = { page: 1, pageSize: 100, order: 'desc' as const };

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([] as never);
  count.mockResolvedValue(0);
  queryRaw.mockResolvedValue([] as never);
  vi.mocked(effectiveThumbnailUrl).mockResolvedValue(null);
  thumbKeys.mockResolvedValue(new Map());
});

describe('ProjectService.listProjects — filtre d’archivage (38.B)', () => {
  it('exclut les projets ARCHIVED par défaut', async () => {
    await listProjects(admin, page);
    const where = findMany.mock.calls[0]![0]!.where as { status: unknown };
    expect(where.status).toEqual({ not: 'ARCHIVED' });
  });

  it('ne renvoie que les ARCHIVED quand onlyArchived', async () => {
    await listProjects(admin, page, true);
    const where = findMany.mock.calls[0]![0]!.where as { status: unknown };
    expect(where.status).toEqual({ status: 'ARCHIVED' }.status);
  });

  it('garde le filtre membership pour un non-global, avec l’exclusion d’archivage', async () => {
    await listProjects(client, page);
    const where = findMany.mock.calls[0]![0]!.where as { status: unknown; memberships: unknown };
    expect(where.status).toEqual({ not: 'ARCHIVED' });
    expect(where.memberships).toEqual({ some: { userId: 9 } });
  });
});

describe('ProjectService.listProjects — miniatures de repli groupées', () => {
  const projects = [
    { id: 1, name: 'A', thumbnailKey: null },
    { id: 2, name: 'B', thumbnailKey: 'explicite/2.jpg' },
    { id: 3, name: 'C', thumbnailKey: null },
  ];

  beforeEach(() => {
    findMany.mockResolvedValue(projects as never);
    count.mockResolvedValue(projects.length);
  });

  it('n’émet qu’UNE demande de miniatures pour toute la page (plus de N+1)', async () => {
    await listProjects(admin, page);
    expect(thumbKeys).toHaveBeenCalledTimes(1);
    expect(thumbKeys).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('rend à chaque projet SA miniature de repli, et null à celui qui n’en a pas', async () => {
    thumbKeys.mockResolvedValue(
      new Map([
        [3, 'thumbs/c.jpg'],
        [1, 'thumbs/a.jpg'],
      ]),
    );
    await listProjects(admin, page);
    const calls = vi.mocked(effectiveThumbnailUrl).mock.calls;
    expect(calls).toEqual([
      [null, 'thumbs/a.jpg'],
      ['explicite/2.jpg', null],
      [null, 'thumbs/c.jpg'],
    ]);
  });
});
