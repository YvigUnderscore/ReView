// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The Episode level is optional: everything below checks that a project where it is switched off — the
 * default case, that of a feature film — can neither receive nor show
 * an episode, and that switching it off destroys nothing.
 */

const { db, thumbs, store } = vi.hoisted(() => ({
  db: {
    project: { findUnique: vi.fn(), update: vi.fn() },
    episode: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    sequence: { count: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    shot: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  thumbs: {
    firstMediaThumbKeysForShots: vi.fn(),
    firstMediaThumbKeysForEpisodes: vi.fn(),
    firstMediaThumbKeyForEpisode: vi.fn(),
    effectiveThumbnailUrl: vi.fn(),
  },
  store: { storage: { getPresignedGetUrl: vi.fn() } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/thumbnails', () => thumbs);
vi.mock('./StorageService', () => store);

import * as EpisodeService from './EpisodeService';
import { AppError } from '../lib/errors';

const enabled = (value: boolean) => db.project.findUnique.mockResolvedValue({ episodesEnabled: value });

beforeEach(() => {
  vi.clearAllMocks();
  db.episode.count.mockResolvedValue(0);
  db.sequence.count.mockResolvedValue(0);
  db.$transaction.mockImplementation((ops: unknown[]) => Promise.resolve(ops));
});

describe('the setting', () => {
  it('is false on a project that does not know it', async () => {
    db.project.findUnique.mockResolvedValue(null);
    expect(await EpisodeService.isEnabled(7)).toBe(false);
  });

  it('refuses any operation with a 409 while it is switched off', async () => {
    enabled(false);
    await expect(EpisodeService.assertEnabled(7)).rejects.toMatchObject({
      statusCode: 409,
      code: 'EPISODES_DISABLED',
    });
  });

  it('lets it through once switched on', async () => {
    enabled(true);
    await expect(EpisodeService.assertEnabled(7)).resolves.toBeUndefined();
  });

  it('switching off deletes neither episode nor attachment', async () => {
    // The adopted behaviour: a display switch does not destroy data that nobody asked to lose. Everything
    // must come back intact on reactivation.
    db.project.update.mockResolvedValue({ id: 7 });
    enabled(false);
    await EpisodeService.setEnabled(7, false);
    expect(db.project.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { episodesEnabled: false },
    });
    expect(db.episode.deleteMany).not.toHaveBeenCalled();
    expect(db.episode.updateMany).not.toHaveBeenCalled();
    expect(db.sequence.updateMany).not.toHaveBeenCalled();
  });

  it('announces what deactivation is going to hide', async () => {
    enabled(true);
    db.episode.count.mockResolvedValue(6);
    db.sequence.count.mockResolvedValue(31);
    expect(await EpisodeService.readSettings(7)).toEqual({
      enabled: true,
      episodeCount: 6,
      linkedSequenceCount: 31,
    });
  });
});

describe('creation', () => {
  it('refuses while the level is switched off', async () => {
    enabled(false);
    await expect(EpisodeService.create(7, { name: 'EP101', code: 'EP101' })).rejects.toBeInstanceOf(AppError);
    expect(db.episode.create).not.toHaveBeenCalled();
  });

  it('refuses a code already taken', async () => {
    enabled(true);
    db.episode.findUnique.mockResolvedValue({ id: 3 });
    await expect(EpisodeService.create(7, { name: 'EP101', code: 'EP101' })).rejects.toMatchObject({
      code: 'CODE_TAKEN',
    });
  });

  it('creates with the requested order', async () => {
    enabled(true);
    db.episode.findUnique.mockResolvedValue(null);
    db.episode.create.mockResolvedValue({ id: 9 });
    await EpisodeService.create(7, { name: 'Pilote', code: 'EP101', order: 2 });
    expect(db.episode.create).toHaveBeenCalledWith({
      data: { projectId: 7, name: 'Pilote', code: 'EP101', order: 2 },
    });
  });
});

/**
 * An episode's image: the list used to return none — not even the one chosen, for lack of a signed URL — and
 * the episode inherited nothing from its shots. Its card therefore stayed under the episode's name
 * indefinitely, whatever the delivered work.
 */
describe('list thumbnail', () => {
  const page = { page: 1, pageSize: 20, order: 'desc' as const };

  it('signs the chosen thumbnail, and falls back on the first media of the shots otherwise', async () => {
    db.episode.findMany.mockResolvedValue([
      { id: 4, code: 'EP101', thumbnailKey: null },
      { id: 5, code: 'EP102', thumbnailKey: 'entity-thumbs/episode/5.jpg' },
    ]);
    db.episode.count.mockResolvedValue(2);
    thumbs.firstMediaThumbKeysForEpisodes.mockResolvedValue(new Map([[4, 'derived/9/thumbnail.webp']]));
    thumbs.effectiveThumbnailUrl.mockImplementation((key: string | null, fallback: string | null) =>
      Promise.resolve(key ?? fallback),
    );

    const res = await EpisodeService.list(7, page);
    expect(res.episodes.map((e) => e.thumbnailUrl)).toEqual([
      'derived/9/thumbnail.webp',
      'entity-thumbs/episode/5.jpg',
    ]);
    // A single query for the whole page: the unit variant would sign one per row.
    expect(thumbs.firstMediaThumbKeysForEpisodes).toHaveBeenCalledTimes(1);
    expect(thumbs.firstMediaThumbKeysForEpisodes).toHaveBeenCalledWith([4, 5]);
  });

  it('leaves the thumbnail null as long as no image exists — the interface displays the name', async () => {
    db.episode.findMany.mockResolvedValue([{ id: 4, code: 'EP101', thumbnailKey: null }]);
    db.episode.count.mockResolvedValue(1);
    thumbs.firstMediaThumbKeysForEpisodes.mockResolvedValue(new Map());
    thumbs.effectiveThumbnailUrl.mockResolvedValue(null);

    const res = await EpisodeService.list(7, page);
    expect(res.episodes[0]!.thumbnailUrl).toBeNull();
  });
});

describe('firstDuplicate', () => {
  it('returns the first repeated code, otherwise null', () => {
    expect(EpisodeService.firstDuplicate(['EP101', 'EP102', 'EP101'])).toBe('EP101');
    expect(EpisodeService.firstDuplicate(['EP101', 'EP102'])).toBeNull();
  });
});

describe('createBulk', () => {
  it('cancels the whole batch on an internal duplicate — nothing is created', async () => {
    enabled(true);
    await expect(
      EpisodeService.createBulk(7, [
        { name: 'a', code: 'EP101' },
        { name: 'b', code: 'EP101' },
      ]),
    ).rejects.toMatchObject({ code: 'CODE_DUP' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('cancels the whole batch on a code already in the database', async () => {
    enabled(true);
    db.episode.findMany.mockResolvedValue([{ code: 'EP101' }]);
    await expect(EpisodeService.createBulk(7, [{ name: 'a', code: 'EP101' }])).rejects.toMatchObject({
      code: 'CODE_TAKEN',
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("numbers the order within the batch's rank", async () => {
    enabled(true);
    db.episode.findMany.mockResolvedValue([]);
    await EpisodeService.createBulk(7, [
      { name: 'a', code: 'EP101' },
      { name: 'b', code: 'EP102' },
    ]);
    expect(db.episode.create).toHaveBeenNthCalledWith(1, {
      data: { projectId: 7, name: 'a', code: 'EP101', order: 0 },
    });
    expect(db.episode.create).toHaveBeenNthCalledWith(2, {
      data: { projectId: 7, name: 'b', code: 'EP102', order: 1 },
    });
  });
});

describe('reorder', () => {
  it('refuses in bulk as soon as an identifier is not from the project', async () => {
    // Applying half the request would leave an order that nobody asked for.
    enabled(true);
    db.episode.findMany.mockResolvedValue([{ id: 1 }]);
    await expect(EpisodeService.reorder(7, [1, 2])).rejects.toMatchObject({ code: 'BAD_EPISODE' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('writes the rank of each episode in the order received', async () => {
    enabled(true);
    db.episode.findMany.mockResolvedValue([{ id: 5 }, { id: 3 }]);
    await EpisodeService.reorder(7, [5, 3]);
    expect(db.episode.update).toHaveBeenNthCalledWith(1, { where: { id: 5 }, data: { order: 0 } });
    expect(db.episode.update).toHaveBeenNthCalledWith(2, { where: { id: 3 }, data: { order: 1 } });
  });
});

describe('assignSequences', () => {
  it('refuses an episode that does not belong to the project', async () => {
    enabled(true);
    db.episode.findFirst.mockResolvedValue(null);
    await expect(EpisodeService.assignSequences(7, 42, [1, 2])).rejects.toMatchObject({
      code: 'BAD_EPISODE',
    });
    expect(db.sequence.updateMany).not.toHaveBeenCalled();
  });

  it('bounds the write to the project, even with a borrowed identifier', async () => {
    enabled(true);
    db.episode.findFirst.mockResolvedValue({ id: 42 });
    db.sequence.updateMany.mockResolvedValue({ count: 1 });
    await EpisodeService.assignSequences(7, 42, [1, 999]);
    expect(db.sequence.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 999] }, projectId: 7, deletedAt: null },
      data: { episodeId: 42 },
    });
  });

  it('detaches with a null episode, without checking anything further', async () => {
    enabled(true);
    db.sequence.updateMany.mockResolvedValue({ count: 2 });
    expect(await EpisodeService.assignSequences(7, null, [1, 2])).toBe(2);
    expect(db.episode.findFirst).not.toHaveBeenCalled();
  });
});
