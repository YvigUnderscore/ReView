// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A shot, sequence or asset that is modified must notify the open screens.
 *
 * The front end has listened to `shot:update`, `sequence:update` and `asset:update` since their introduction
 * (`v2/lib/socketBridge`), but only `PipelineEnsureService` (automatic creation on upload) and the ShotGrid synchronization
 * emitted them: none of the paths a human editing in the interface takes. A status changed by right-click therefore stayed
 * invisible on every other screen until reload, to the point of making the change look as if it had not gone through.
 *
 * These three assertions close the loop on the emitter side; the front-end test `currentProject` closes it on the receiver
 * side (the page must first join the project's room).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, socket } = vi.hoisted(() => ({
  db: {
    shot: { update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    sequence: { update: vi.fn() },
    asset: { update: vi.fn(), count: vi.fn() },
  },
  socket: { emitToProject: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./SocketService', () => socket);
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('./shotgrid/ShotgridGuardService', () => ({ assertDescriptionWritable: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('./PipelineStatusService', () => ({ assertBelongsToProject: vi.fn() }));

import * as ShotService from './ShotService';
import * as SequenceService from './SequenceService';
import * as AssetService from './AssetService';

const PROJECT = 7;

beforeEach(() => {
  vi.clearAllMocks();
  db.shot.update.mockResolvedValue({ id: 21 });
  db.sequence.update.mockResolvedValue({ id: 13 });
  db.asset.update.mockResolvedValue({ id: 58, shots: [], sequences: [] });
  db.asset.count.mockResolvedValue(0);
});

/** Events emitted for this project, by name. */
function emitted(name: string) {
  return socket.emitToProject.mock.calls.filter((c) => c[1] === name);
}

describe('entity events emitted by the ordinary edit paths', () => {
  it('a modified shot emits shot:update for its project', async () => {
    await ShotService.update(21, PROJECT, { pipelineStatusId: 8 });
    expect(emitted('shot:update')).toEqual([[PROJECT, 'shot:update', { projectId: PROJECT, id: 21 }]]);
  });

  it('a modified shot still emits timeline:update (automatic timelines)', async () => {
    await ShotService.update(21, PROJECT, { omitted: true });
    expect(emitted('timeline:update')).toHaveLength(1);
  });

  it('a modified sequence emits sequence:update for its project', async () => {
    await SequenceService.update(13, PROJECT, { pipelineStatusId: 8 });
    expect(emitted('sequence:update')).toEqual([
      [PROJECT, 'sequence:update', { projectId: PROJECT, id: 13 }],
    ]);
  });

  it('a modified asset emits asset:update for its project', async () => {
    await AssetService.update(PROJECT, 58, { pipelineStatusId: 8 });
    expect(emitted('asset:update')).toEqual([[PROJECT, 'asset:update', { projectId: PROJECT, id: 58 }]]);
  });

  it('emits even when the change does not touch the status', async () => {
    await ShotService.update(21, PROJECT, { name: 'Snow field, wide' });
    await SequenceService.update(13, PROJECT, { name: 'Cold open' });
    await AssetService.update(PROJECT, 58, { name: 'Kitchen Set' });
    expect(emitted('shot:update')).toHaveLength(1);
    expect(emitted('sequence:update')).toHaveLength(1);
    expect(emitted('asset:update')).toHaveLength(1);
  });
});
