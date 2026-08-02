// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    reviewStatus: {
      count: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    reviewDecision: { count: vi.fn(), findMany: vi.fn() },
    version: { findFirst: vi.fn() },
    mediaObject: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn() }));
vi.mock('./WatchService', () => ({ notifyWatchers: vi.fn().mockResolvedValue([]) }));

import { ensureDefaultStatuses, listStatuses, deleteStatus, decide } from './ReviewDecisionService';
import { prisma } from '../lib/prisma';
import { emitToProject } from './SocketService';
import { notify } from './NotificationService';
import { logAudit } from './AuditService';
import { Role } from '@prisma/client';

const admin = { id: 1, role: Role.ADMIN };
const supervisor = { id: 2, role: Role.SUPERVISOR };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureDefaultStatuses', () => {
  it('crée les 4 statuts classiques quand la table est vide', async () => {
    vi.mocked(prisma.reviewStatus.count).mockResolvedValue(0 as never);
    await ensureDefaultStatuses();
    expect(prisma.reviewStatus.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ name: 'Pending', isDefault: true }),
          expect.objectContaining({ name: 'Approved', isApproval: true }),
          expect.objectContaining({ name: 'Retake', isRetake: true }),
          expect.objectContaining({ name: 'CBB' }),
        ]),
      }),
    );
  });

  it('ne recrée rien si des statuts existent', async () => {
    vi.mocked(prisma.reviewStatus.count).mockResolvedValue(2 as never);
    await ensureDefaultStatuses();
    expect(prisma.reviewStatus.createMany).not.toHaveBeenCalled();
  });
});

describe('listStatuses', () => {
  it('bootstrape puis liste ordonnée', async () => {
    vi.mocked(prisma.reviewStatus.count).mockResolvedValue(4 as never);
    vi.mocked(prisma.reviewStatus.findMany).mockResolvedValue([{ id: 1 }] as never);
    const out = await listStatuses();
    expect(out).toEqual([{ id: 1 }]);
    expect(prisma.reviewStatus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    );
  });
});

describe('deleteStatus', () => {
  it('refuse (409) la suppression d’un statut utilisé', async () => {
    vi.mocked(prisma.reviewDecision.count).mockResolvedValue(3 as never);
    await expect(deleteStatus(admin, 5)).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.reviewStatus.delete).not.toHaveBeenCalled();
  });

  it('supprime un statut inutilisé et audite', async () => {
    vi.mocked(prisma.reviewDecision.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.reviewStatus.delete).mockResolvedValue({} as never);
    await deleteStatus(admin, 5);
    expect(prisma.reviewStatus.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'review_status.delete' }));
  });
});

describe('decide', () => {
  const decisionRow = { id: 10, statusId: 2, status: { name: 'Approved' } };

  beforeEach(() => {
    vi.mocked(prisma.version.findFirst).mockResolvedValue({
      id: 42,
      name: 'V02',
      taskId: 7,
      assetId: null,
      authorId: 9,
    } as never);
    vi.mocked(prisma.reviewStatus.findUnique).mockResolvedValue({ id: 2, name: 'Approved' } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue(decisionRow as never);
  });

  it('historise, dénormalise, audite, émet et notifie l’auteur', async () => {
    const out = await decide(supervisor, 3, 42, 2, 'ok pour livraison');
    expect(out).toBe(decisionRow);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'version.decision', entityId: 42 }),
    );
    expect(emitToProject).toHaveBeenCalledWith(3, 'version:update', expect.objectContaining({ id: 42 }));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 9, type: 'review_decision', projectId: 3, referenceId: 42 }),
    );
  });

  it('ne se notifie pas soi-même', async () => {
    vi.mocked(prisma.version.findFirst).mockResolvedValue({
      id: 42,
      name: 'V02',
      taskId: 7,
      assetId: null,
      authorId: supervisor.id,
    } as never);
    await decide(supervisor, 3, 42, 2);
    expect(notify).not.toHaveBeenCalled();
  });

  it('404 sur version inconnue, 400 sur statut inconnu', async () => {
    vi.mocked(prisma.version.findFirst).mockResolvedValue(null as never);
    await expect(decide(supervisor, 3, 999, 2)).rejects.toMatchObject({ statusCode: 404 });
    vi.mocked(prisma.version.findFirst).mockResolvedValue({ id: 42, authorId: null } as never);
    vi.mocked(prisma.reviewStatus.findUnique).mockResolvedValue(null as never);
    await expect(decide(supervisor, 3, 42, 77)).rejects.toMatchObject({ statusCode: 400 });
  });
});
