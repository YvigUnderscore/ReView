// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany, update, emitShotsUpdated, checkAccess, logAudit } = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  emitShotsUpdated: vi.fn(),
  checkAccess: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: { shot: { findMany } } }));
vi.mock('./ShotService', () => ({ update, emitShotsUpdated }));
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
 * The multiple selection only offered "Assign" and "Delete", whereas the daily gesture of a production is to
 * move thirty shots into retake at once, and right-clicking a single shot does offer the status.
 */
describe('bulkPatchShotStatus', () => {
  it('applies the status to each shot, through the same path as the singular action', async () => {
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
    expect(update).toHaveBeenCalledWith(1, 461, { pipelineStatusId: 12 }, 5, {
      deferEvents: true,
    });
  });

  it('accepts clearing the status', async () => {
    findMany.mockResolvedValue([{ id: 1, projectId: 461 }]);
    await bulkPatchShotStatus(user, [1], null);
    expect(update).toHaveBeenCalledWith(1, 461, { pipelineStatusId: null }, 5, {
      deferEvents: true,
    });
  });

  /** A shot locked by ShotGrid must not make the other forty-nine fail. */
  it('counts refusals separately instead of failing the batch', async () => {
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

  it('refuses a selection spanning two projects', async () => {
    findMany.mockResolvedValue([
      { id: 1, projectId: 461 },
      { id: 2, projectId: 999 },
    ]);
    await expect(bulkPatchShotStatus(user, [1, 2], 12)).rejects.toMatchObject({ statusCode: 403 });
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses an account that does not belong to the project', async () => {
    findMany.mockResolvedValue([{ id: 1, projectId: 461 }]);
    checkAccess.mockResolvedValue(false);
    await expect(bulkPatchShotStatus(user, [1], 12)).rejects.toMatchObject({ statusCode: 403 });
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a selection in which no shot remains', async () => {
    findMany.mockResolvedValue([]);
    await expect(bulkPatchShotStatus(user, [42], 12)).rejects.toMatchObject({ statusCode: 404 });
  });

  /**
   * The measure of the fix: a batch of thirty shots emitted thirty `shot:update` and thirty
   * `timeline:update`, each reloading the WHOLE kanban on every connected client. It now emits ONE, carrying
   * the thirty identifiers.
   */
  it('emits only one event for the whole batch', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    findMany.mockResolvedValue(ids.map((id) => ({ id, projectId: 461 })));

    await bulkPatchShotStatus(user, ids, 12);

    expect(update).toHaveBeenCalledTimes(30);
    expect(emitShotsUpdated).toHaveBeenCalledTimes(1);
    expect(emitShotsUpdated).toHaveBeenCalledWith(461, ids);
  });

  /** A refused shot did not change: announcing it would reload its detail view for nothing. */
  it('announces only the shots that were actually modified', async () => {
    findMany.mockResolvedValue([
      { id: 1, projectId: 461 },
      { id: 2, projectId: 461 },
      { id: 3, projectId: 461 },
    ]);
    update
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('verrou ShotGrid'))
      .mockResolvedValueOnce({});

    await expect(bulkPatchShotStatus(user, [1, 2, 3], 12)).resolves.toEqual({
      updated: 2,
      failed: 1,
    });
    expect(emitShotsUpdated).toHaveBeenCalledWith(461, [1, 3]);
  });

  it('leaves an audit trace with the count of refusals', async () => {
    findMany.mockResolvedValue([{ id: 1, projectId: 461 }]);
    await bulkPatchShotStatus(user, [1], 12);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SHOT_BULK_STATUS', entityId: 461 }),
    );
  });
});
