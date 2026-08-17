// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { project: { findMany: vi.fn(), count: vi.fn() } },
}));
vi.mock('../lib/thumbnails', () => ({
  firstMediaThumbKeyForProject: vi.fn().mockResolvedValue(null),
  effectiveThumbnailUrl: vi.fn().mockResolvedValue(null),
}));

import { listProjects } from './ProjectService';
import { prisma } from '../lib/prisma';
import { Role } from '@prisma/client';

const findMany = vi.mocked(prisma.project.findMany);
const count = vi.mocked(prisma.project.count);
const admin = { id: 1, role: Role.ADMIN };
const client = { id: 9, role: Role.CLIENT };
const page = { page: 1, pageSize: 100, order: 'desc' as const };

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([] as never);
  count.mockResolvedValue(0);
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
