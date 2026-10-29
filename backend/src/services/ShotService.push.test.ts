// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, push } = vi.hoisted(() => ({
  db: {
    shot: { update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    sequence: { findUnique: vi.fn() },
  },
  push: { enqueuePush: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('./PipelineStatusService', () => ({ assertBelongsToProject: vi.fn() }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: push.enqueuePush }));
vi.mock('../lib/thumbnails', () => ({
  firstMediaThumbKeyForShot: vi.fn(),
  firstMediaThumbKeysForShots: vi.fn(),
  effectiveThumbnailUrl: vi.fn(),
}));

import { update } from './ShotService';

beforeEach(() => {
  vi.clearAllMocks();
  db.shot.update.mockResolvedValue({ id: 7, code: 'SH010' });
});

describe('ShotService.update: write to ShotGrid', () => {
  it('queues the status when it changes', async () => {
    // It went nowhere: the shot changed state in ReView, the site kept the old one, and the
    // next synchronisation brought the site's value back.
    await update(7, 461, { pipelineStatusId: 42 }, 3);
    expect(push.enqueuePush).toHaveBeenCalledWith(461, {
      type: 'shot-status',
      shotId: 7,
      actorId: 3,
    });
  });

  it('also queues clearing the status', async () => {
    await update(7, 461, { pipelineStatusId: null }, 3);
    expect(push.enqueuePush).toHaveBeenCalledTimes(1);
  });

  it('writes nothing to the site when the status is untouched', async () => {
    // Renaming a shot must not trigger a status write: the site asked for nothing, and a useless
    // write makes the timestamps diverge.
    db.shot.findUnique.mockResolvedValue({ code: 'SH010', sequenceId: 1 });
    db.shot.findFirst.mockResolvedValue(null);
    await update(7, 461, { name: 'Rooftop' }, 3);
    expect(push.enqueuePush).not.toHaveBeenCalled();
  });

  it('accepts not knowing the author: the write goes out anyway', async () => {
    await update(7, 461, { pipelineStatusId: 42 });
    expect(push.enqueuePush).toHaveBeenCalledWith(461, {
      type: 'shot-status',
      shotId: 7,
      actorId: undefined,
    });
  });
});
