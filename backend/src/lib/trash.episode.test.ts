// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * An episode's trash must carry NOTHING away.
 *
 * An episode groups sequences, it does not own them: moving it to the trash or purging it
 * must touch neither its sequences nor, behind them, the shots, versions and comments.
 * This is the only thing these tests verify, and the only thing that cannot be recovered.
 */

const { db } = vi.hoisted(() => ({
  db: {
    episode: { update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    sequence: { update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    shot: { updateMany: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock('./prisma', () => ({ prisma: db }));
vi.mock('../services/StorageService', () => ({
  storage: { deleteObject: vi.fn(), deletePrefix: vi.fn() },
}));
vi.mock('../services/JobService', () => ({ enqueueStorageCleanup: vi.fn() }));

import {
  purgeEpisode,
  restoreEpisode,
  restoreEpisodes,
  softDeleteEpisode,
  softDeleteEpisodes,
} from './trash';

beforeEach(() => vi.clearAllMocks());

const nothingElseTouched = () => {
  expect(db.sequence.update).not.toHaveBeenCalled();
  expect(db.sequence.updateMany).not.toHaveBeenCalled();
  expect(db.sequence.delete).not.toHaveBeenCalled();
  expect(db.sequence.deleteMany).not.toHaveBeenCalled();
  expect(db.shot.updateMany).not.toHaveBeenCalled();
  expect(db.shot.deleteMany).not.toHaveBeenCalled();
};

describe('episode trash', () => {
  it('moving to the trash only marks the episode', async () => {
    await softDeleteEpisode(9);
    expect(db.episode.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { deletedAt: expect.any(Date) },
    });
    nothingElseTouched();
  });

  it('restoring only restores the episode: its attachment never moved', async () => {
    await restoreEpisode(9);
    expect(db.episode.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { deletedAt: null } });
    nothingElseTouched();
  });

  it('purging destroys the episode and nothing else: its sequences survive, detached', async () => {
    await purgeEpisode(9);
    expect(db.episode.delete).toHaveBeenCalledWith({ where: { id: 9 } });
    nothingElseTouched();
  });

  it('in bulk, same rules', async () => {
    await softDeleteEpisodes([1, 2]);
    expect(db.episode.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
      data: { deletedAt: expect.any(Date) },
    });
    await restoreEpisodes([1, 2]);
    expect(db.episode.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
      data: { deletedAt: null },
    });
    nothingElseTouched();
  });
});
