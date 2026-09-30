// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    shotgridConnection: { findUnique: vi.fn() },
    reviewStatus: {
      count: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    reviewDecision: { count: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    version: { findFirst: vi.fn() },
    mediaObject: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./NotificationService', () => ({ notify: vi.fn() }));
vi.mock('./WatchService', () => ({ notifyWatchers: vi.fn().mockResolvedValue([]) }));

import {
  ensureDefaultStatuses,
  listStatuses,
  deleteStatus,
  decide,
  decideAsGuest,
  guestStatuses,
} from './ReviewDecisionService';
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
    vi.mocked(prisma.reviewStatus.count).mockResolvedValue(0);
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
    vi.mocked(prisma.reviewStatus.count).mockResolvedValue(2);
    await ensureDefaultStatuses();
    expect(prisma.reviewStatus.createMany).not.toHaveBeenCalled();
  });
});

describe('listStatuses', () => {
  it('bootstrape puis liste ordonnée', async () => {
    vi.mocked(prisma.reviewStatus.count).mockResolvedValue(4);
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
    vi.mocked(prisma.reviewDecision.count).mockResolvedValue(3);
    await expect(deleteStatus(admin, 5)).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.reviewStatus.delete).not.toHaveBeenCalled();
  });

  it('supprime un statut inutilisé et audite', async () => {
    vi.mocked(prisma.reviewDecision.count).mockResolvedValue(0);
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
    vi.mocked(prisma.$transaction).mockResolvedValue(decisionRow);
    vi.mocked(prisma.mediaObject.findFirst).mockResolvedValue({ id: 128 } as never);
  });

  it('historise, dénormalise, audite, émet et notifie l’auteur', async () => {
    const out = await decide(supervisor, 3, 42, 2, 'ok pour livraison');
    expect(out).toBe(decisionRow);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'VERSION_DECISION', entityId: 42 }),
    );
    expect(emitToProject).toHaveBeenCalledWith(3, 'version:update', expect.objectContaining({ id: 42 }));
    // `referenceId` est le PREMIER MÉDIA de la version, pas la version : l'auteur recevait
    // un id de version et les suiveurs un id de média pour le même événement, si bien que le
    // lien de l'auteur — le plus concerné — ne menait nulle part.
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 9,
        kind: 'reviewDecision',
        projectId: 3,
        referenceId: 128,
      }),
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
    vi.mocked(prisma.version.findFirst).mockResolvedValue(null);
    await expect(decide(supervisor, 3, 999, 2)).rejects.toMatchObject({ statusCode: 404 });
    vi.mocked(prisma.version.findFirst).mockResolvedValue({ id: 42, authorId: null } as never);
    vi.mocked(prisma.reviewStatus.findUnique).mockResolvedValue(null);
    await expect(decide(supervisor, 3, 42, 77)).rejects.toMatchObject({ statusCode: 400 });
  });
});

/**
 * L'avis d'un client, qui n'est PAS une décision.
 *
 * Toute la différence tient dans une ligne absente : `Version.reviewStatusId` n'est pas
 * touché. Quelqu'un d'extérieur au studio ne fait pas bouger l'état d'un plan pour toute
 * l'équipe — surtout pas en cliquant à côté. Ces tests tiennent cette frontière, parce
 * qu'elle ne se voit pas à la lecture : le code qui la franchirait ressemblerait à du code
 * correct.
 */
describe('decideAsGuest — un avis, pas un verdict', () => {
  const STATUSES = [
    { id: 1, name: 'Pending', color: '#F5A623', isApproval: false, isRetake: false, isDefault: true },
    { id: 2, name: 'Approved', color: '#2ECC71', isApproval: true, isRetake: false, isDefault: false },
    { id: 3, name: 'Retake', color: '#E74C3C', isApproval: false, isRetake: true, isDefault: false },
  ];
  const guest = { name: 'Claire', shareLinkId: 7 };

  beforeEach(() => {
    vi.mocked(prisma.reviewStatus.count).mockResolvedValue(STATUSES.length);
    vi.mocked(prisma.reviewStatus.findMany).mockResolvedValue(STATUSES as never);
    vi.mocked(prisma.shotgridConnection.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.version.findFirst).mockResolvedValue({
      id: 42,
      name: 'V03',
      authorId: 9,
    } as never);
    vi.mocked(prisma.mediaObject.findFirst).mockResolvedValue({ id: 128 } as never);
    vi.mocked(prisma.reviewDecision.create).mockResolvedValue({ id: 5, status: STATUSES[1] } as never);
  });

  it('n’offre au client que la validation et la retake, pas les états de pipeline', async () => {
    const offered = await guestStatuses(1);
    expect(offered.approval).toMatchObject({ id: 2, name: 'Approved' });
    expect(offered.retake).toMatchObject({ id: 3, name: 'Retake' });
    expect(JSON.stringify(offered)).not.toContain('Pending');
  });

  /** Le cœur du lot : l'avis s'inscrit, le statut de la version ne bouge pas. */
  it('écrit l’avis sans jamais toucher au statut courant de la version', async () => {
    await decideAsGuest(guest, 1, 42, 2);
    expect(prisma.reviewDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ versionId: 42, statusId: 2, guestName: 'Claire', shareLinkId: 7 }),
      }),
    );
    // `version.update` n'existe même pas sur le mock : l'appeler ferait échouer le test.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Un invité qui poserait « Pending » écrirait un état de pipeline depuis l'extérieur.
  it('refuse un statut qui n’est pas l’un des deux offerts', async () => {
    await expect(decideAsGuest(guest, 1, 42, 1)).rejects.toThrowError(
      expect.objectContaining({ statusCode: 400 }),
    );
    expect(prisma.reviewDecision.create).not.toHaveBeenCalled();
  });

  it('refuse une version inconnue avant de regarder le statut', async () => {
    vi.mocked(prisma.version.findFirst).mockResolvedValue(null);
    await expect(decideAsGuest(guest, 1, 999, 2)).rejects.toThrowError(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it('journalise le lien et le nom, et prévient l’auteur de la livraison', async () => {
    await decideAsGuest(guest, 1, 42, 3);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SHARE_DECISION',
        metadata: expect.objectContaining({ shareLinkId: 7, guestName: 'Claire' }),
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 9, messageKey: 'notification.clientDecision' }),
    );
  });
});
