// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { project: { findMany: vi.fn() }, $queryRaw: vi.fn() },
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/trash', () => ({
  softDeleteProject: vi.fn(),
  restoreProject: vi.fn(),
  purgeProject: vi.fn(),
}));
vi.mock('../lib/thumbnails', () => ({ effectiveThumbnailUrl: vi.fn() }));

import { listUsage } from './ProjectService';
import { prisma } from '../lib/prisma';

const findMany = vi.mocked(prisma.project.findMany);
const queryRaw = vi.mocked(prisma.$queryRaw);

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([
    { id: 1, name: 'A', slug: 'a', storageQuota: 10n },
    { id: 2, name: 'B', slug: 'b', storageQuota: null },
  ] as never);
  queryRaw.mockResolvedValue([] as never);
});

describe('ProjectService.listUsage (38.D)', () => {
  it('n’agrège qu’UNE fois pour tous les projets (plus une somme par projet)', async () => {
    await listUsage();
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rend à chaque projet SA consommation, et zéro à celui qui n’a rien', async () => {
    queryRaw.mockResolvedValue([{ projectId: 1, bytes: 4096n }] as never);
    expect(await listUsage()).toEqual([
      { id: 1, name: 'A', slug: 'a', usage: 4096, quota: 10 },
      { id: 2, name: 'B', slug: 'b', usage: 0, quota: null },
    ]);
  });

  it('ignore les médias qu’aucun projet ne réclame (projectId nul)', async () => {
    queryRaw.mockResolvedValue([
      { projectId: null, bytes: 999n },
      { projectId: 2, bytes: 8n },
    ] as never);
    const rows = await listUsage();
    expect(rows.find((r) => r.id === 2)!.usage).toBe(8);
    expect(rows.find((r) => r.id === 1)!.usage).toBe(0);
  });
});
