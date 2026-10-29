// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: { mediaObject: { findMany: vi.fn(), findFirst: vi.fn() }, $queryRaw: vi.fn() },
}));
vi.mock('./storage', () => ({
  storage: { getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`https://minio/${key}`)) },
}));

import { Prisma } from '@prisma/client';
import {
  effectiveThumbnailUrl,
  firstMediaThumbKeysForShots,
  firstMediaThumbKeysForAssets,
  firstMediaThumbKeysForSequences,
  firstMediaThumbKeysForEpisodes,
  firstMediaThumbKeysForProjects,
} from './thumbnails';
import { prisma } from './prisma';
import { storage } from './storage';

const findMany = vi.mocked(prisma.mediaObject.findMany);
const queryRaw = vi.mocked(prisma.$queryRaw);

/**
 * Rebuilds the request actually sent: the SQL text (whitespace normalized) and the bound
 * parameters. This is what allows checking the election rule AND the fact that the page's
 * identifiers travel as parameters, never concatenated into the text.
 */
function sqlOf(call: number): { text: string; values: unknown[] } {
  const args = queryRaw.mock.calls[call] as unknown as [TemplateStringsArray, ...Prisma.Sql[]];
  const built = Prisma.sql(args[0], ...args.slice(1));
  return { text: built.text.replace(/\s+/g, ' ').trim(), values: built.values };
}

beforeEach(() => vi.clearAllMocks());

/**
 * The "effective" thumbnail of a card: the one chosen by hand if it exists, otherwise the
 * one of the first published media. This is the only point that presigns list thumbnails:
 * about a hundred calls per project opening.
 */
describe('effectiveThumbnailUrl', () => {
  it('prefers the explicit thumbnail over the fallback', async () => {
    await expect(effectiveThumbnailUrl('entity-thumbs/shot/1.jpg', 'derived/9/thumbnail.jpg')).resolves.toBe(
      'https://minio/entity-thumbs/shot/1.jpg',
    );
  });

  it('falls back to the first published media', async () => {
    await expect(effectiveThumbnailUrl(null, 'derived/9/thumbnail.jpg')).resolves.toBe(
      'https://minio/derived/9/thumbnail.jpg',
    );
  });

  it('signs nothing when the entity has no image', async () => {
    await expect(effectiveThumbnailUrl(null, null)).resolves.toBeNull();
    expect(storage.getPresignedGetUrl).not.toHaveBeenCalled();
  });
});

/**
 * Grouped variants: one query for a whole page of cards. The election rule (the oldest
 * published media wins) is that of the single variant; checking it here prevents a page
 * from changing thumbnail depending on the code path taken.
 *
 * The election is done in the database (`DISTINCT ON`) and no longer in memory: this is
 * the PERF-02 fix. The previous `findMany` pulled back ALL published media of the hundred
 * shots on the page (2,009 rows measured at ten versions per shot) to keep only a hundred.
 */
describe('grouped thumbnails', () => {
  it('elects the oldest media of each shot, in one query', async () => {
    queryRaw.mockResolvedValue([
      { parentId: 1, thumbnailKey: 'a.jpg' },
      { parentId: 2, thumbnailKey: 'c.jpg' },
    ] as never);
    await expect(firstMediaThumbKeysForShots([1, 2])).resolves.toEqual(
      new Map([
        [1, 'a.jpg'],
        [2, 'c.jpg'],
      ]),
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const { text, values } = sqlOf(0);
    // One row per shot, the oldest; `m.id` breaks ties between two media created in the same
    // millisecond, which the in-memory election used to leave to chance.
    expect(text).toContain('DISTINCT ON (t."shotId")');
    expect(text).toContain('ORDER BY t."shotId", m."createdAt" ASC, m.id ASC');
    expect(text).toContain('t."shotId" IN ($1,$2)');
    expect(values).toEqual([1, 2]);
  });

  it('no longer pulls back the whole page to keep one row per parent', async () => {
    queryRaw.mockResolvedValue([] as never);
    await firstMediaThumbKeysForShots([1, 2]);
    await firstMediaThumbKeysForAssets([5]);
    await firstMediaThumbKeysForSequences([3]);
    await firstMediaThumbKeysForEpisodes([7]);
    // The wide read (all candidate media, election in Node) no longer exists.
    expect(findMany).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(4);
    for (let i = 0; i < 4; i += 1) expect(sqlOf(i).text).toContain('DISTINCT ON');
  });

  it('keeps the original filter: published, not deleted, with a thumbnail', async () => {
    queryRaw.mockResolvedValue([] as never);
    await firstMediaThumbKeysForShots([1]);
    const { text } = sqlOf(0);
    expect(text).toContain('m.published = true');
    expect(text).toContain('m."deletedAt" IS NULL');
    expect(text).toContain('m."thumbnailKey" IS NOT NULL');
  });

  it('attaches the asset carried by the version the same way as the one carried by the task', async () => {
    queryRaw.mockResolvedValue([
      { parentId: 5, thumbnailKey: 'direct.jpg' },
      { parentId: 6, thumbnailKey: 'viaTask.jpg' },
    ] as never);
    await expect(firstMediaThumbKeysForAssets([5, 6])).resolves.toEqual(
      new Map([
        [5, 'direct.jpg'],
        [6, 'viaTask.jpg'],
      ]),
    );
    const { text, values } = sqlOf(0);
    expect(text).toContain('DISTINCT ON (COALESCE(v."assetId", t."assetId"))');
    // Both attachment paths, hence the identifiers passed twice.
    expect(values).toEqual([5, 6, 5, 6]);
  });

  it('does not query the database for an empty page', async () => {
    await expect(firstMediaThumbKeysForShots([])).resolves.toEqual(new Map());
    await expect(firstMediaThumbKeysForAssets([])).resolves.toEqual(new Map());
    await expect(firstMediaThumbKeysForSequences([])).resolves.toEqual(new Map());
    await expect(firstMediaThumbKeysForEpisodes([])).resolves.toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

/**
 * The fallback of a project is elected by a single SQL query (`DISTINCT ON`): the single
 * variant inside a `.map` ran a hundred `findFirst` with a triple OR per opening of the
 * sidebar. The project list AND the home page both use it: both must show the same image
 * of the same project.
 */
describe('project thumbnails', () => {
  it('maps each key to the project it comes from, in one query', async () => {
    queryRaw.mockResolvedValue([
      { projectId: 3, thumbnailKey: 'thumbs/c.jpg' },
      { projectId: 1, thumbnailKey: 'thumbs/a.jpg' },
    ] as never);
    await expect(firstMediaThumbKeysForProjects([1, 2, 3])).resolves.toEqual(
      new Map([
        [3, 'thumbs/c.jpg'],
        [1, 'thumbs/a.jpg'],
      ]),
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('queries nothing when the page is empty', async () => {
    await expect(firstMediaThumbKeysForProjects([])).resolves.toEqual(new Map());
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

/**
 * Sequences and episodes had no fallback image: their cards stayed empty even once the
 * work was delivered, for lack of a rule. They inherit the one of the shots (the first
 * published media), walking it up one level (shot → sequence) or two (→ episode).
 */
describe('sequence and episode thumbnails', () => {
  it('walks up to the shot to elect the image of a sequence', async () => {
    queryRaw.mockResolvedValue([
      { parentId: 3, thumbnailKey: 'a.jpg' },
      { parentId: 4, thumbnailKey: 'c.jpg' },
    ] as never);
    await expect(firstMediaThumbKeysForSequences([3, 4])).resolves.toEqual(
      new Map([
        [3, 'a.jpg'],
        [4, 'c.jpg'],
      ]),
    );
    expect(sqlOf(0).text).toContain('DISTINCT ON (sh."sequenceId")');
  });

  it('drops deleted or hidden shots: a sequence does not carry the image of a shot no longer visible in it', async () => {
    queryRaw.mockResolvedValue([] as never);
    await firstMediaThumbKeysForSequences([3]);
    const { text, values } = sqlOf(0);
    expect(text).toContain('sh."sequenceId" IN ($1)');
    expect(text).toContain('sh."deletedAt" IS NULL');
    expect(text).toContain('sh."hiddenAt" IS NULL');
    expect(values).toEqual([3]);
  });

  it("walks up to the episode through the shot's sequence, excluding a deleted sequence", async () => {
    queryRaw.mockResolvedValue([{ parentId: 7, thumbnailKey: 'ep.jpg' }] as never);
    await expect(firstMediaThumbKeysForEpisodes([7])).resolves.toEqual(new Map([[7, 'ep.jpg']]));
    const { text, values } = sqlOf(0);
    expect(text).toContain('DISTINCT ON (sq."episodeId")');
    expect(text).toContain('sq."deletedAt" IS NULL');
    expect(text).toContain('sh."deletedAt" IS NULL');
    expect(text).toContain('sh."hiddenAt" IS NULL');
    expect(values).toEqual([7]);
  });

  it('ignores a media whose attachment chain is broken', async () => {
    // A version attached to an asset has no task, hence no shot: it says nothing about a
    // sequence and must not show up there. The closed joins (`JOIN`, not `LEFT JOIN`) exclude
    // it in the database.
    queryRaw.mockResolvedValue([] as never);
    await firstMediaThumbKeysForSequences([3]);
    const { text } = sqlOf(0);
    expect(text).toContain('JOIN "Task" t ON t.id = v."taskId"');
    expect(text).toContain('JOIN "Shot" sh ON sh.id = t."shotId"');
    expect(text).not.toContain('LEFT JOIN');
  });
});
