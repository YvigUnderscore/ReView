// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Real-time events for a batch of shots.
 *
 * A production action on thirty shots used to emit thirty `shot:update` and thirty `timeline:update`;
 * each one reloaded the WHOLE kanban on every connected user's screen. It now emits a single pair,
 * which carries the thirty identifiers. The singular form is unchanged, otherwise every existing consumer
 * would have to be rewritten.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { socket, db } = vi.hoisted(() => ({
  socket: { emitToProject: vi.fn() },
  db: { shot: { update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./SocketService', () => socket);
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('./shotgrid/ShotgridGuardService', () => ({ assertDescriptionWritable: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('./PipelineStatusService', () => ({ assertBelongsToProject: vi.fn() }));

import { emitShotsUpdated, update } from './ShotService';

const PROJECT = 7;

beforeEach(() => {
  vi.clearAllMocks();
  db.shot.update.mockResolvedValue({ id: 21 });
});

describe('emitShotsUpdated', () => {
  it('one shot: exactly the previous payload, with no batch field', () => {
    emitShotsUpdated(PROJECT, [21]);

    expect(socket.emitToProject.mock.calls).toEqual([
      [PROJECT, 'shot:update', { projectId: PROJECT, id: 21 }],
      [PROJECT, 'timeline:update', { projectId: PROJECT, shotId: 21 }],
    ]);
  });

  it('thirty shots: two events in total, not sixty', () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);

    emitShotsUpdated(PROJECT, ids);

    expect(socket.emitToProject).toHaveBeenCalledTimes(2);
    expect(socket.emitToProject.mock.calls).toEqual([
      [PROJECT, 'shot:update', { projectId: PROJECT, id: 1, ids }],
      [PROJECT, 'timeline:update', { projectId: PROJECT, shotId: 1, ids }],
    ]);
  });

  it('an empty batch emits nothing: a fully refused batch wakes nobody', () => {
    emitShotsUpdated(PROJECT, []);

    expect(socket.emitToProject).not.toHaveBeenCalled();
  });

  it('the batch is copied: the caller\'s array may live its own life', () => {
    const ids = [4, 5];
    emitShotsUpdated(PROJECT, ids);
    ids.push(6);

    expect(socket.emitToProject.mock.calls[0]?.[2]).toEqual({
      projectId: PROJECT,
      id: 4,
      ids: [4, 5],
    });
  });

    /**
     * The contract that `BulkService` relies on: the loop emits nothing, the caller emits once.
     * Without `deferEvents`, thirty passes produced sixty events.
     */
  it('deferEvents holds back the emissions of the single-item path', async () => {
    await update(21, PROJECT, { pipelineStatusId: 8 }, 5, { deferEvents: true });

    expect(socket.emitToProject).not.toHaveBeenCalled();
  });

  it('without deferEvents, the single-item path emits its two events as before', async () => {
    await update(21, PROJECT, { pipelineStatusId: 8 }, 5);

    expect(socket.emitToProject).toHaveBeenCalledTimes(2);
  });
});
