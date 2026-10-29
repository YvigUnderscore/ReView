// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { project: { findMany: vi.fn(), count: vi.fn() }, $queryRaw: vi.fn() },
}));
// The grouped query itself (`DISTINCT ON`) lives in `lib/thumbnails` and is tested there: this file checks
// what the list does with it — one pass for the page, and the right fallback key attributed to the right
// project.
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

describe('ProjectService.listProjects: archiving filter (38.B)', () => {
  it('excludes ARCHIVED projects by default', async () => {
    await listProjects(admin, page);
    const where = findMany.mock.calls[0]![0]!.where as { status: unknown };
    expect(where.status).toEqual({ not: 'ARCHIVED' });
  });

  it('returns only the ARCHIVED ones when onlyArchived', async () => {
    await listProjects(admin, page, true);
    const where = findMany.mock.calls[0]![0]!.where as { status: unknown };
    expect(where.status).toEqual({ status: 'ARCHIVED' }.status);
  });

  it('keeps the membership filter for a non-global user, with the archiving exclusion', async () => {
    await listProjects(client, page);
    const where = findMany.mock.calls[0]![0]!.where as { status: unknown; memberships: unknown };
    expect(where.status).toEqual({ not: 'ARCHIVED' });
    expect(where.memberships).toEqual({ some: { userId: 9 } });
  });
});

describe('ProjectService.listProjects: grouped fallback thumbnails', () => {
  const projects = [
    { id: 1, name: 'A', thumbnailKey: null },
    { id: 2, name: 'B', thumbnailKey: 'explicite/2.jpg' },
    { id: 3, name: 'C', thumbnailKey: null },
  ];

  beforeEach(() => {
    findMany.mockResolvedValue(projects as never);
    count.mockResolvedValue(projects.length);
  });

  it('issues only ONE thumbnail request for the whole page (no more N+1)', async () => {
    await listProjects(admin, page);
    expect(thumbKeys).toHaveBeenCalledTimes(1);
    expect(thumbKeys).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('gives each project ITS fallback thumbnail, and null to the one that has none', async () => {
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
