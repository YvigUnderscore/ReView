// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { avatarUrl } from './userView';

/**
 * What a shot, sequence or asset card shows beyond its name.
 *
 * A card used to say only "twelve tasks", which answered none of the questions one asks while scanning a
 * grid of two hundred shots: what is it, who is on it, is there something to look at, and since when has
 * it not moved. The first three come from relations; the fourth from a count no Prisma `_count` can
 * express — hence this grouped query.
 */

/**
 * Common selection of assigned people.
 *
 * `avatarKey` rather than a URL: the MinIO signature is computed when serving, and a page of two hundred
 * cards should not ask for two hundred signatures.
 */
export const CARD_ASSIGNEE_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  username: true,
  avatarKey: true,
} as const;

/** A person as read from the database for a card. */
export interface RawCardAssignee {
  id: number;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  avatarKey: string | null;
}

/** The same, ready to display: the object key has become a signed URL. */
export type CardAssignee = Omit<RawCardAssignee, 'avatarKey'> & { avatarUrl: string | null };

/**
 * Signs the avatars of a whole page, **once per person**.
 *
 * A grid of two hundred shots carries two hundred times the same ten faces. Signing card by card would
 * request two hundred signatures for ten distinct objects; the key map deduplicates before signing, and
 * the `StorageService` cache does the rest.
 */
export async function signAssignees<T extends { assignees: RawCardAssignee[] }>(
  rows: T[],
): Promise<(Omit<T, 'assignees'> & { assignees: CardAssignee[] })[]> {
  const keys = new Set<string>();
  for (const row of rows) for (const a of row.assignees) if (a.avatarKey) keys.add(a.avatarKey);
  const urls = new Map<string, string | null>();
  await Promise.all([...keys].map(async (key) => urls.set(key, await avatarUrl(key))));

  return rows.map((row) => ({
    ...row,
    assignees: row.assignees.map(({ avatarKey, ...person }) => ({
      ...person,
      avatarUrl: avatarKey ? (urls.get(avatarKey) ?? null) : null,
    })),
  }));
}

/**
 * How many deliveries await a review decision, per entity.
 *
 * "Awaiting" is defined strictly: a **published** version (hence visible to a supervisor) that carries **no
 * decision** (`reviewStatusId` null). A version still in draft awaits nobody, and neither does one already
 * approved or rejected.
 *
 * A single query for the whole page: the per-card variant would ask for two hundred aggregates to display
 * two hundred badges.
 */
export async function awaitingReviewByShot(shotIds: number[]): Promise<Map<number, number>> {
  if (shotIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ shotId: number; count: number }[]>`
    SELECT t."shotId" AS "shotId", COUNT(*)::int AS "count"
    FROM "Version" v
    JOIN "Task" t ON t.id = v."taskId"
    WHERE t."shotId" = ANY(${shotIds})
      AND v."deletedAt" IS NULL
      AND v.published = true
      AND v."reviewStatusId" IS NULL
    GROUP BY t."shotId"
  `;
  return new Map(rows.map((r) => [r.shotId, r.count]));
}

/**
 * Same count for assets — two attachment paths.
 *
 * A version may hang from a task of the asset **or** from the asset itself (`Version` carries a parent XOR).
 * Counting only one left half of the deliveries out of the count, depending on how the studio publishes.
 */
export async function awaitingReviewByAsset(assetIds: number[]): Promise<Map<number, number>> {
  if (assetIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ assetId: number; count: number }[]>`
    SELECT COALESCE(v."assetId", t."assetId") AS "assetId", COUNT(*)::int AS "count"
    FROM "Version" v
    LEFT JOIN "Task" t ON t.id = v."taskId"
    WHERE COALESCE(v."assetId", t."assetId") = ANY(${assetIds})
      AND v."deletedAt" IS NULL
      AND v.published = true
      AND v."reviewStatusId" IS NULL
    GROUP BY 1
  `;
  return new Map(rows.map((r) => [r.assetId, r.count]));
}

/**
 * Same count aggregated at sequence level: its shots combined.
 *
 * A sequence has no delivery of its own; what awaits it is what awaits its shots. A sequence supervisor reads
 * this badge to know whether there are dailies to review.
 */
export async function awaitingReviewBySequence(sequenceIds: number[]): Promise<Map<number, number>> {
  if (sequenceIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ sequenceId: number; count: number }[]>`
    SELECT s."sequenceId" AS "sequenceId", COUNT(*)::int AS "count"
    FROM "Version" v
    JOIN "Task" t ON t.id = v."taskId"
    JOIN "Shot" s ON s.id = t."shotId"
    WHERE s."sequenceId" = ANY(${sequenceIds})
      AND s."deletedAt" IS NULL
      AND s."hiddenAt" IS NULL
      AND v."deletedAt" IS NULL
      AND v.published = true
      AND v."reviewStatusId" IS NULL
    GROUP BY s."sequenceId"
  `;
  return new Map(rows.map((r) => [r.sequenceId, r.count]));
}
