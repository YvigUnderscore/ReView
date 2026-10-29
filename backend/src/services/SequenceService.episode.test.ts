// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Attaches a sequence to an episode when it is created in bulk. The level is optional: without an
 * episode, creation must stay exactly as before.
 */

const { db } = vi.hoisted(() => ({
  db: {
    sequence: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    episode: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/thumbnails', () => ({
  firstMediaThumbKeysForShots: vi.fn(),
  firstMediaThumbKeysForAssets: vi.fn(),
  firstMediaThumbKeysForSequences: vi.fn(),
  firstMediaThumbKeyForSequence: vi.fn(),
  effectiveThumbnailUrl: vi.fn(),
}));
vi.mock('./StorageService', () => ({ storage: { getPresignedGetUrl: vi.fn() } }));

import { createBulk, getDetail } from './SequenceService';

beforeEach(() => {
  vi.clearAllMocks();
  db.sequence.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation((ops: unknown[]) => Promise.resolve(ops));
});

describe('SequenceService.createBulk', () => {
  it('creates outside an episode when none is given: the feature-film case', async () => {
    await createBulk(7, [{ name: 'SQ010', code: 'SQ010' }]);
    expect(db.episode.count).not.toHaveBeenCalled();
    expect(db.sequence.create).toHaveBeenCalledWith({
      data: { projectId: 7, name: 'SQ010', code: 'SQ010', order: 0, episodeId: null },
    });
  });

  it('refuses an episode borrowed from another project: nothing is created', async () => {
    // The attachment is visible from neither page: it must be refused up front.
    db.episode.count.mockResolvedValue(0);
    await expect(createBulk(7, [{ name: 'SQ010', code: 'SQ010', episodeId: 42 }])).rejects.toMatchObject({
      code: 'BAD_EPISODE',
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('checks each episode only once, whatever the number of sequences', async () => {
    db.episode.count.mockResolvedValue(1);
    await createBulk(7, [
      { name: 'SQ010', code: 'SQ010', episodeId: 4 },
      { name: 'SQ020', code: 'SQ020', episodeId: 4 },
    ]);
    expect(db.episode.count).toHaveBeenCalledTimes(1);
    expect(db.episode.count).toHaveBeenCalledWith({
      where: { id: { in: [4] }, projectId: 7, deletedAt: null },
    });
  });
});

describe('SequenceService.getDetail', () => {
  const sequence = (episodesEnabled: boolean) => ({
    id: 3,
    thumbnailKey: null,
    shots: [],
    assets: [],
    episode: { id: 11, code: 'EP101', name: 'EP101' },
    project: { episodesEnabled },
  });

  it('returns the episode when the level is enabled', async () => {
    db.sequence.findUnique.mockResolvedValue(sequence(true));
    await expect(getDetail(3)).resolves.toMatchObject({ episode: { code: 'EP101' } });
  });

  it('hides it when the level is off: the attachment survives, the trace does not', async () => {
    // Switching the level off destroys nothing: `episodeId` stays in the database. But the screen of a
    // project that does not know the level must not start showing a link to an episode.
    db.sequence.findUnique.mockResolvedValue(sequence(false));
    await expect(getDetail(3)).resolves.toMatchObject({ episode: null });
  });

  it('does not leak the project setting into the response', async () => {
    db.sequence.findUnique.mockResolvedValue(sequence(false));
    expect(await getDetail(3)).not.toHaveProperty('project');
  });
});
