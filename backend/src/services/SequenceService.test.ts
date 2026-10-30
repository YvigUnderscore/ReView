// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    sequence: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    // "Waiting for review" badge of the shots: a grouped SQL aggregate for the sheet.
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn((ops: unknown[]) => Promise.resolve(ops)),
  },
}));

vi.mock('../lib/thumbnails', () => ({
  effectiveThumbnailUrl: vi.fn((key: string | null, fallback: string | null) =>
    Promise.resolve(key ? `url:${key}` : fallback ? `url:${fallback}` : null),
  ),
  firstMediaThumbKeysForShots: vi.fn().mockResolvedValue(new Map([[2, 'derived/9/thumbnail.webp']])),
  // The sequence and its assets now have the same fallback image as its shots: the
  // first published media. With no media, the card falls back to the name, on the interface side.
  firstMediaThumbKeysForAssets: vi.fn().mockResolvedValue(new Map()),
  firstMediaThumbKeysForSequences: vi.fn().mockResolvedValue(new Map()),
  firstMediaThumbKeyForSequence: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/storage', () => ({
  storage: { getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`url:${key}`)) },
}));

import { createBulk, getDetail, signSequenceThumbnails } from './SequenceService';
import { prisma } from '../lib/prisma';
import {
  firstMediaThumbKeyForSequence,
  firstMediaThumbKeysForAssets,
  firstMediaThumbKeysForSequences,
  firstMediaThumbKeysForShots,
} from '../lib/thumbnails';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
});

describe('createBulk', () => {
  it('refuses an internal duplicate within the batch, before any write', async () => {
    await expect(
      createBulk(1, [
        { code: 'SQ01', name: 'A' },
        { code: 'SQ01', name: 'B' },
      ]),
    ).rejects.toThrow(/SQ01/);
    expect(prisma.sequence.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses the whole batch if a code already exists: nothing partial', async () => {
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([{ code: 'SQ02' }] as never);
    await expect(
      createBulk(1, [
        { code: 'SQ01', name: 'A' },
        { code: 'SQ02', name: 'B' },
      ]),
    ).rejects.toThrow(/SQ02/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('numbers the sequences in the order received when no order is given', async () => {
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([] as never);
    await createBulk(3, [
      { code: 'SQ01', name: 'A' },
      { code: 'SQ02', name: 'B', order: 9 },
    ]);
    const created = vi.mocked(prisma.sequence.create).mock.calls.map((c) => c[0].data);
    // `episodeId: null`: the Episode level is optional, and a sequence created without an
    // episode stays outside any episode, the normal state of a feature film.
    expect(created).toEqual([
      { projectId: 3, name: 'A', code: 'SQ01', order: 0, episodeId: null },
      { projectId: 3, name: 'B', code: 'SQ02', order: 9, episodeId: null },
    ]);
  });
});

describe('getDetail', () => {
  const sequence = {
    id: 5,
    projectId: 1,
    code: 'SQ01',
    thumbnailKey: 'entity-thumbs/sequence/5.jpg',
    // `assignees`: Prisma always returns the relation requested in `include`.
    shots: [
      {
        id: 1,
        code: 'SH010',
        thumbnailKey: 'entity-thumbs/shot/1.jpg',
        assets: [],
        assignees: [],
        _count: { tasks: 2 },
      },
      { id: 2, code: 'SH020', thumbnailKey: null, assets: [], assignees: [], _count: { tasks: 0 } },
      { id: 3, code: 'SH030', thumbnailKey: null, assets: [], assignees: [], _count: { tasks: 1 } },
    ],
    assets: [{ id: 8, name: 'Ship', type: 'PROP', typeLabel: null, thumbnailKey: null }],
    departments: [{ id: 4, key: 'comp', name: 'Compositing', color: null }],
    episode: null,
    // Episode level switched off: the default state of every project.
    project: { episodesEnabled: false },
  };

  it('reports a missing sequence rather than returning an empty object', async () => {
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue(null);
    await expect(getDetail(404)).rejects.toThrow();
  });

  it('resolves thumbnails: explicit, otherwise published media, otherwise nothing', async () => {
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue(sequence as never);
    const detail = await getDetail(5);
    expect(detail.thumbnailUrl).toBe('url:entity-thumbs/sequence/5.jpg');
    expect(detail.shots.map((s) => s.thumbnailUrl)).toEqual([
      'url:entity-thumbs/shot/1.jpg', // thumbnail chosen by hand
      'url:derived/9/thumbnail.webp', // falls back to the first published media
      null, // neither one
    ]);
  });

  it('also gives a fallback image to the sequence and its assets', async () => {
    // Neither of them had one: their card stayed empty even once the shots were delivered,
    // although the image existed one level down.
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue({
      ...sequence,
      thumbnailKey: null,
    } as never);
    vi.mocked(firstMediaThumbKeyForSequence).mockResolvedValue('derived/12/thumbnail.webp');
    vi.mocked(firstMediaThumbKeysForAssets).mockResolvedValue(new Map([[8, 'derived/13/thumbnail.webp']]));

    const detail = await getDetail(5);
    expect(detail.thumbnailUrl).toBe('url:derived/12/thumbnail.webp');
    expect(detail.assets.map((a) => a.thumbnailUrl)).toEqual(['url:derived/13/thumbnail.webp']);
    expect(firstMediaThumbKeysForAssets).toHaveBeenCalledWith([8]);
  });

  it('requests the shot thumbnails in a single pass, not one per shot', async () => {
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue(sequence as never);
    await getDetail(5);
    expect(firstMediaThumbKeysForShots).toHaveBeenCalledTimes(1);
    expect(firstMediaThumbKeysForShots).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('bounds the shots and assets of the sheet, and returns the real count', async () => {
    // The sheet displays everything at once: without a cap, a badly split sequence would
    // fetch half of the feature film on every opening.
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue(sequence as never);
    await getDetail(5);
    const include = vi.mocked(prisma.sequence.findUnique).mock.calls[0]![0].include as {
      shots: { take: number; orderBy: unknown };
      assets: { take: number; orderBy: unknown };
      _count: unknown;
    };
    expect(include.shots.take).toBe(500);
    expect(include.assets.take).toBe(500);
    expect(include._count).toEqual({
      select: { shots: { where: { deletedAt: null, hiddenAt: null } } },
    });
  });

  it('breaks ties in shot order by id', async () => {
    // Shots from an import share order = 0; the code is not enough either when two merged
    // sequences carry the same numbering.
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue(sequence as never);
    await getDetail(5);
    const include = vi.mocked(prisma.sequence.findUnique).mock.calls[0]![0].include as {
      shots: { orderBy: unknown };
    };
    expect(include.shots.orderBy).toEqual([{ order: 'asc' }, { code: 'asc' }, { id: 'asc' }]);
  });
});

/**
 * The sequence list carried no thumbnail: the field did not exist in the response, so a sequence card
 * stayed grey whatever happened. It now follows the common rule: the chosen thumbnail, otherwise the
 * first image of its shots.
 */
describe('signSequenceThumbnails', () => {
  it('prefers the chosen thumbnail, falls back on the shots, and invents nothing', async () => {
    vi.mocked(firstMediaThumbKeysForSequences).mockResolvedValue(new Map([[2, 'derived/7/thumbnail.webp']]));
    const rows = [
      { id: 1, thumbnailKey: 'entity-thumbs/sequence/1.jpg' },
      { id: 2, thumbnailKey: null },
      { id: 3, thumbnailKey: null },
    ];
    const signed = await signSequenceThumbnails(rows);
    expect(signed.map((s) => s.thumbnailUrl)).toEqual([
      'url:entity-thumbs/sequence/1.jpg',
      'url:derived/7/thumbnail.webp',
      null,
    ]);
    // One query for the whole page: the sidebar tree loads two hundred at once.
    expect(firstMediaThumbKeysForSequences).toHaveBeenCalledTimes(1);
    expect(firstMediaThumbKeysForSequences).toHaveBeenCalledWith([1, 2, 3]);
  });
});
