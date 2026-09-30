// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    reviewStatus: { count: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    reviewDecision: { findMany: vi.fn() },
    version: { findFirst: vi.fn() },
    mediaObject: { findFirst: vi.fn() },
    shotgridConnection: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn() }));
vi.mock('./WatchService', () => ({ notifyWatchers: vi.fn().mockResolvedValue([]) }));
vi.mock('./ChatNotifyService', () => ({ notifyChat: vi.fn() }));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('../lib/pipeline', () => ({ resolveProjectIdForVersion: vi.fn() }));
vi.mock('../lib/projectRoles', () => ({ assertProjectManage: vi.fn() }));

import { decideMany } from './ReviewDecisionService';
import { prisma } from '../lib/prisma';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import { assertProjectManage } from '../lib/projectRoles';
import { notifyChat } from './ChatNotifyService';
import { Role } from '@prisma/client';

const supervisor = { id: 2, role: Role.SUPERVISOR };
const approved = { id: 7, name: 'Approved', isApproval: true, isRetake: false };

/** Les versions 100 et 101 vivent dans le projet 5, la 102 dans le projet 9. */
const projectOfVersion: Record<number, number> = { 100: 5, 101: 5, 102: 9 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.reviewStatus.findUnique).mockResolvedValue(approved as never);
  // Vocabulaire du studio : `listStatusesForProject` y retombe sur un projet autonome.
  vi.mocked(prisma.reviewStatus.count).mockResolvedValue(4);
  vi.mocked(prisma.reviewStatus.findMany).mockResolvedValue([approved] as never);
  vi.mocked(prisma.shotgridConnection.findUnique).mockResolvedValue(null);
  vi.mocked(resolveProjectIdForVersion).mockImplementation((id: number) =>
    Promise.resolve(projectOfVersion[id] ?? null),
  );
  vi.mocked(assertProjectManage).mockResolvedValue(undefined);
  vi.mocked(prisma.version.findFirst).mockImplementation(
    (args: unknown) =>
      Promise.resolve({
        id: (args as { where: { id: number } }).where.id,
        name: 'v01',
        authorId: null,
      }) as never,
  );
  vi.mocked(prisma.mediaObject.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.$transaction).mockResolvedValue({ id: 1 });
});

describe('decideMany', () => {
  it('pose la décision sur chaque version et ne contrôle qu’une fois par projet', async () => {
    const r = await decideMany(supervisor, [100, 101, 102], 7, 'ok pour moi');
    expect(r).toEqual({ updated: 3, failed: 0 });
    // Trois versions, deux projets : deux contrôles de supervision, pas trois.
    expect(vi.mocked(assertProjectManage).mock.calls.map((c) => c[2])).toEqual([5, 9]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('n’annonce qu’une ligne de messagerie pour tout le lot', async () => {
    await decideMany(supervisor, [100, 101, 102], 7);
    expect(notifyChat).toHaveBeenCalledTimes(1);
  });

  it('compte en échec les versions d’un projet où l’on ne supervise pas', async () => {
    vi.mocked(assertProjectManage).mockImplementation((_u, _r, projectId: number) =>
      projectId === 9 ? Promise.reject(new Error('403')) : Promise.resolve(undefined),
    );
    const r = await decideMany(supervisor, [100, 101, 102], 7);
    expect(r).toEqual({ updated: 2, failed: 1 });
  });

  it('compte en échec un statut absent du vocabulaire du projet', async () => {
    // Le statut existe au studio mais le projet relié n'en propose pas l'id.
    vi.mocked(prisma.shotgridConnection.findUnique).mockResolvedValue({
      active: true,
      settings: { versionStatusMap: { app: 99 } },
    } as never);
    const r = await decideMany(supervisor, [100, 102], 7);
    expect(r).toEqual({ updated: 0, failed: 2 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuse tout le lot si le statut lui-même n’existe pas', async () => {
    vi.mocked(prisma.reviewStatus.findUnique).mockResolvedValue(null);
    await expect(decideMany(supervisor, [100], 999)).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('compte en échec une version dont le projet est introuvable', async () => {
    const r = await decideMany(supervisor, [404], 7);
    expect(r).toEqual({ updated: 0, failed: 1 });
    expect(assertProjectManage).not.toHaveBeenCalled();
  });
});
