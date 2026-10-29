// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { storage } from '../services/StorageService';

/**
 * Resolution of "effective" thumbnails for cards (projects, assets, shots).
 * Rule: explicit thumbnail (thumbnailKey) if set, otherwise that of the first linked
 * published media. Returns a presigned URL ready for display (or null).
 */

const firstMediaThumbKey = async (versionFilter: object): Promise<string | null> => {
  const media = await prisma.mediaObject.findFirst({
    where: { published: true, deletedAt: null, thumbnailKey: { not: null }, version: versionFilter },
    orderBy: { createdAt: 'asc' },
    select: { thumbnailKey: true },
  });
  return media?.thumbnailKey ?? null;
};

export const firstMediaThumbKeyForProject = (projectId: number) =>
  firstMediaThumbKey({
    OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
  });

export const firstMediaThumbKeyForAsset = (assetId: number) =>
  firstMediaThumbKey({ OR: [{ assetId }, { task: { assetId } }] });

export const firstMediaThumbKeyForShot = (shotId: number) => firstMediaThumbKey({ task: { shotId } });

/**
 * A sequence and an episode used to have no fallback image either: only a thumbnail
 * uploaded by hand gave them one, so their cards stayed empty while their shots had one.
 * They therefore inherit the same rule: the thumbnail of the first published media of one
 * of their shots. Deleted or hidden shots are excluded: a sequence must not display the
 * image of a shot that is no longer visible in it.
 */
export const firstMediaThumbKeyForSequence = (sequenceId: number) =>
  firstMediaThumbKey({ task: { shot: { sequenceId, deletedAt: null, hiddenAt: null } } });

export const firstMediaThumbKeyForEpisode = (episodeId: number) =>
  firstMediaThumbKey({
    task: { shot: { deletedAt: null, hiddenAt: null, sequence: { episodeId, deletedAt: null } } },
  });

/**
 * Grouped variants (B3): a single query for a whole page of cards.
 *
 * The lists called the single variant inside a `.map`: a hundred shots, a hundred queries,
 * followed by a hundred MinIO signatures. That is what made opening a project slow long
 * before volume became a problem.
 *
 * Grouping was then done by a `findMany` WITHOUT `take`, followed by an in-memory election
 * of the first media per parent: a page of a hundred shots pulled back all published media
 * of those hundred shots (2,009 rows measured at ten versions per shot) to keep only one
 * per shot. The amplification factor is the number of media per shot, which nothing bounds
 * in a living project.
 *
 * The election therefore happens where it costs least: `DISTINCT ON` on the PostgreSQL side
 * returns ONE row per parent, as `firstMediaThumbKeysForProjects` already does further down.
 * The page's identifiers travel as bound parameters (`Prisma.join`), never concatenated.
 *
 * `m.id` breaks ties between two media created in the same millisecond: the previous
 * election broke them by chance (whichever came first in the execution plan), so there was
 * no guarantee of rendering the same image twice.
 */
async function firstThumbKeysBy(
  // SQL fragments written here, never built from input: `parentKey` is the expression
  // identifying the parent, `joins` the path leading there from the version, and `filter`
  // the restriction to the requested page.
  parentKey: Prisma.Sql,
  joins: Prisma.Sql,
  filter: Prisma.Sql,
): Promise<Map<number, string>> {
  const rows = await prisma.$queryRaw<{ parentId: number; thumbnailKey: string }[]>`
    SELECT DISTINCT ON (${parentKey}) ${parentKey} AS "parentId",
           m."thumbnailKey"          AS "thumbnailKey"
    FROM "MediaObject" m
    JOIN "Version" v ON v.id = m."versionId"
    ${joins}
    WHERE m.published = true
      AND m."deletedAt" IS NULL
      AND m."thumbnailKey" IS NOT NULL
      AND ${filter}
    ORDER BY ${parentKey}, m."createdAt" ASC, m.id ASC
  `;
  const out = new Map<number, string>();
  for (const row of rows) out.set(row.parentId, row.thumbnailKey);
  return out;
}

/** Fallback thumbnail of each shot in the list, in one query. */
export function firstMediaThumbKeysForShots(shotIds: number[]): Promise<Map<number, string>> {
  if (shotIds.length === 0) return Promise.resolve(new Map());
  return firstThumbKeysBy(
    Prisma.sql`t."shotId"`,
    Prisma.sql`JOIN "Task" t ON t.id = v."taskId"`,
    Prisma.sql`t."shotId" IN (${Prisma.join(shotIds)})`,
  );
}

/**
 * Fallback thumbnail of each asset in the list, in one query.
 *
 * A version can hang directly off the asset or go through a task: the parent is the first
 * of the two attachments, exactly as the in-memory election did.
 */
export function firstMediaThumbKeysForAssets(assetIds: number[]): Promise<Map<number, string>> {
  if (assetIds.length === 0) return Promise.resolve(new Map());
  return firstThumbKeysBy(
    Prisma.sql`COALESCE(v."assetId", t."assetId")`,
    Prisma.sql`LEFT JOIN "Task" t ON t.id = v."taskId"`,
    Prisma.sql`(v."assetId" IN (${Prisma.join(assetIds)}) OR t."assetId" IN (${Prisma.join(assetIds)}))`,
  );
}

/** Fallback thumbnail of each sequence in the list, in one query. */
export function firstMediaThumbKeysForSequences(sequenceIds: number[]): Promise<Map<number, string>> {
  if (sequenceIds.length === 0) return Promise.resolve(new Map());
  return firstThumbKeysBy(
    Prisma.sql`sh."sequenceId"`,
    Prisma.sql`JOIN "Task" t ON t.id = v."taskId" JOIN "Shot" sh ON sh.id = t."shotId"`,
    // A deleted or hidden shot does not lend its image to its sequence (original rule).
    Prisma.sql`sh."sequenceId" IN (${Prisma.join(sequenceIds)}) AND sh."deletedAt" IS NULL AND sh."hiddenAt" IS NULL`,
  );
}

/** Fallback thumbnail of each episode in the list: the first media of one of its shots. */
export function firstMediaThumbKeysForEpisodes(episodeIds: number[]): Promise<Map<number, string>> {
  if (episodeIds.length === 0) return Promise.resolve(new Map());
  return firstThumbKeysBy(
    Prisma.sql`sq."episodeId"`,
    Prisma.sql`JOIN "Task" t ON t.id = v."taskId"
               JOIN "Shot" sh ON sh.id = t."shotId"
               JOIN "Sequence" sq ON sq.id = sh."sequenceId"`,
    Prisma.sql`sq."episodeId" IN (${Prisma.join(episodeIds)})
               AND sq."deletedAt" IS NULL
               AND sh."deletedAt" IS NULL
               AND sh."hiddenAt" IS NULL`,
  );
}
/**
 * Fallback thumbnail of each project on the page, in ONE query.
 *
 * The list called `firstMediaThumbKeyForProject` inside a `.map`: a hundred projects, a
 * hundred `findFirst` each carrying a triple OR version → task → shot/asset → project. Yet
 * the sidebar calls this route on almost every screen. `DISTINCT ON` elects the first
 * published media of each project on the PostgreSQL side, without pulling back the rest.
 */
export async function firstMediaThumbKeysForProjects(projectIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (projectIds.length === 0) return out;
  const rows = await prisma.$queryRaw<{ projectId: number; thumbnailKey: string }[]>`
    SELECT DISTINCT ON (COALESCE(sh."projectId", ta."projectId", va."projectId"))
           COALESCE(sh."projectId", ta."projectId", va."projectId") AS "projectId",
           m."thumbnailKey"                                        AS "thumbnailKey"
    FROM "MediaObject" m
    JOIN "Version" v      ON v.id  = m."versionId"
    LEFT JOIN "Task" t    ON t.id  = v."taskId"
    LEFT JOIN "Shot" sh   ON sh.id = t."shotId"
    LEFT JOIN "Asset" ta  ON ta.id = t."assetId"
    LEFT JOIN "Asset" va  ON va.id = v."assetId"
    WHERE m.published = true
      AND m."deletedAt" IS NULL
      AND m."thumbnailKey" IS NOT NULL
      AND COALESCE(sh."projectId", ta."projectId", va."projectId") IN (${Prisma.join(projectIds)})
    ORDER BY COALESCE(sh."projectId", ta."projectId", va."projectId"), m."createdAt" ASC, m.id ASC
  `;
  for (const row of rows) out.set(row.projectId, row.thumbnailKey);
  return out;
}

/** Signed URL of the effective thumbnail (explicit, or first-media fallback). */
export async function effectiveThumbnailUrl(
  explicitKey: string | null,
  fallbackKey: string | null,
): Promise<string | null> {
  const key = explicitKey ?? fallbackKey;
  return key ? storage.getPresignedGetUrl(key) : null;
}
