// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany, update, checkAccess, logAudit } = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  checkAccess: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: { shot: { findMany } } }));
vi.mock('./ShotService', () => ({ update }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: checkAccess }));
vi.mock('./AuditService', () => ({ logAudit }));

import { bulkPatchShotStatus } from './BulkService';
import { Role } from '@prisma/client';

const user = { id: 5, role: Role.SUPERVISOR };

beforeEach(() => {
  vi.clearAllMocks();
  checkAccess.mockResolvedValue(true);
  update.mockResolvedValue({});
});

/**
 * La sélection multiple n'offrait que « Assigner » et « Supprimer », alors que le geste
 * quotidien d'une production consiste à passer trente plans en retake d'un coup — et que le
 * clic droit sur un seul plan propose bien le statut.
 */
describe('bulkPatchShotStatus', () => {
  it('applique le statut à chaque plan, par le même chemin qu’au singulier', async () => {
    findMany.mockResolvedValue([
      { id: 1, projectId: 461 },
      { id: 2, projectId: 461 },
      { id: 3, projectId: 461 },
    ]);

    await expect(bulkPatchShotStatus(user, [1, 2, 3], 12)).resolves.toEqual({
      updated: 3,
      failed: 0,
    });
    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenCalledWith(1, 461, { pipelineStatusId: 12 }, 5);
  });

  it('accepte le retrait du statut', async () => {
    findMany.mockResolvedValue([{ id: 1, projectId: 461 }]);
    await bulkPatchShotStatus(user, [1], null);
    expect(update).toHaveBeenCalledWith(1, 461, { pipelineStatusId: null }, 5);
  });

  /** Un plan verrouillé par ShotGrid ne doit pas faire perdre les quarante-neuf autres. */
  it('compte les refus à part au lieu de faire tomber le lot', async () => {
    findMany.mockResolvedValue([
      { id: 1, projectId: 461 },
      { id: 2, projectId: 461 },
    ]);
    update.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('verrou ShotGrid'));

    await expect(bulkPatchShotStatus(user, [1, 2], 12)).resolves.toEqual({
      updated: 1,
      failed: 1,
    });
  });

  it('refuse une sélection qui traverse deux projets', async () => {
    findMany.mockResolvedValue([
      { id: 1, projectId: 461 },
      { id: 2, projectId: 999 },
    ]);
    await expect(bulkPatchShotStatus(user, [1, 2], 12)).rejects.toMatchObject({ statusCode: 403 });
    expect(update).not.toHaveBeenCalled();
  });

  it('refuse un compte étranger au projet', async () => {
    findMany.mockResolvedValue([{ id: 1, projectId: 461 }]);
    checkAccess.mockResolvedValue(false);
    await expect(bulkPatchShotStatus(user, [1], 12)).rejects.toMatchObject({ statusCode: 403 });
    expect(update).not.toHaveBeenCalled();
  });

  it('refuse une sélection dont aucun plan ne subsiste', async () => {
    findMany.mockResolvedValue([]);
    await expect(bulkPatchShotStatus(user, [42], 12)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('laisse une trace d’audit avec le compte des refus', async () => {
    findMany.mockResolvedValue([{ id: 1, projectId: 461 }]);
    await bulkPatchShotStatus(user, [1], 12);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SHOT_BULK_STATUS', entityId: 461 }),
    );
  });
});
