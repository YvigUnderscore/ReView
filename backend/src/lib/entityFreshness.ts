// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';

/**
 * When an entity last moved — its own AND that of its descendants.
 *
 * **The trap.** `Shot.updatedAt` and `Sequence.updatedAt` do not move when a descendant media is published:
 * publishing writes to the version and the media, never to the shot carrying them. A "not seen" glow based
 * on the shot's own `updatedAt` would therefore never light up where it matters — precisely on the delivery
 * being awaited.
 *
 * **Why compute rather than propagate.** A `lastActivityAt` column kept up to date on write would be cheaper
 * to read, but it would have to be written from every path that counts as activity: publication, review
 * decision, media upload, task status change, rename... A forgotten path goes unnoticed — the badge stays
 * off and nobody knows why. A computation can be reread and tested. The cost is the one already accepted on
 * these same lists, that of `awaitingReviewByShot`: grouped aggregates, one per level, for the whole page.
 *
 * **Query shape.** Never a join per card, never a correlated subquery, and never two levels of descendants in
 * a single `JOIN`: thirty shots × five tasks × ten versions × two media is three thousand rows to aggregate
 * per sequence. Each level is therefore a flat, independent aggregate, all launched together and merged here
 * keeping the most recent date. Measured on a project of forty thousand media, that is what separates a list
 * that answers from one that collapses.
 */

/** An entity as the list has already read it: its id and its own modification date. */
export interface FreshnessRow {
  id: number;
  updatedAt: Date;
}

/** Aggregate row: the most recent date found under an entity (or none). */
interface LatestRow {
  id: number;
  at: Date | null;
}

/**
 * Merges the aggregates: the entity's own date, raised by those of its descendants when more recent.
 */
export function mergeLatest(seed: FreshnessRow[], aggregates: LatestRow[][]): Map<number, Date> {
  const out = new Map<number, Date>(seed.map((r) => [r.id, r.updatedAt]));
  for (const rows of aggregates) {
    for (const row of rows) {
      if (!row.at) continue;
      const known = out.get(row.id);
      // `!known` does not happen in practice (the aggregate is bounded to the seeded ids) but keeps the
      // function total: an unexpected row must not vanish silently.
      if (!known || row.at > known) out.set(row.id, row.at);
    }
  }
  return out;
}

/**
 * Unseen = never opened, or opened before the last activity.
 *
 * The comparison is strict: opening an entity writes the visit **after** the activity, so `visit > activity`
 * and the glow goes out. On a perfect tie (same millisecond), the entity is considered seen — the case of a
 * visit written right after a change made by the same person, who has nothing to signal to themselves.
 */
export function unseenFrom(activity: Map<number, Date>, visits: Map<number, Date>): Map<number, boolean> {
  const out = new Map<number, boolean>();
  for (const [id, at] of activity) {
    const seen = visits.get(id);
    out.set(id, !seen || at > seen);
  }
  return out;
}

/**
 * Activity of a shot: its own, that of its tasks, deliveries and their media.
 *
 * Tasks count: changing a task's status is the most frequent gesture in production, and it writes nothing
 * on the shot.
 */
export async function activityByShot(rows: FreshnessRow[]): Promise<Map<number, Date>> {
  if (rows.length === 0) return new Map();
  const ids = rows.map((r) => r.id);
  const [tasks, versions, medias] = await Promise.all([
    prisma.$queryRaw<LatestRow[]>`
      SELECT "shotId" AS "id", MAX("updatedAt") AS "at"
      FROM "Task"
      WHERE "shotId" = ANY(${ids})
      GROUP BY "shotId"
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT t."shotId" AS "id", MAX(v."updatedAt") AS "at"
      FROM "Version" v
      JOIN "Task" t ON t.id = v."taskId"
      WHERE t."shotId" = ANY(${ids}) AND v."deletedAt" IS NULL
      GROUP BY t."shotId"
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT t."shotId" AS "id", MAX(m."createdAt") AS "at"
      FROM "MediaObject" m
      JOIN "Version" v ON v.id = m."versionId"
      JOIN "Task" t ON t.id = v."taskId"
      WHERE t."shotId" = ANY(${ids}) AND m."deletedAt" IS NULL AND v."deletedAt" IS NULL
      GROUP BY t."shotId"
    `,
  ]);
  return mergeLatest(rows, [tasks, versions, medias]);
}

/**
 * Activity of a sequence: its own and that of its shots, down to the media.
 *
 * Hidden or trashed shots are excluded, as everywhere else: a sequence must not light up for a shot nobody
 * sees any more.
 */
export async function activityBySequence(rows: FreshnessRow[]): Promise<Map<number, Date>> {
  if (rows.length === 0) return new Map();
  const ids = rows.map((r) => r.id);
  const [shots, tasks, versions, medias] = await Promise.all([
    prisma.$queryRaw<LatestRow[]>`
      SELECT "sequenceId" AS "id", MAX("updatedAt") AS "at"
      FROM "Shot"
      WHERE "sequenceId" = ANY(${ids}) AND "deletedAt" IS NULL AND "hiddenAt" IS NULL
      GROUP BY "sequenceId"
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT s."sequenceId" AS "id", MAX(t."updatedAt") AS "at"
      FROM "Task" t
      JOIN "Shot" s ON s.id = t."shotId"
      WHERE s."sequenceId" = ANY(${ids}) AND s."deletedAt" IS NULL AND s."hiddenAt" IS NULL
      GROUP BY s."sequenceId"
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT s."sequenceId" AS "id", MAX(v."updatedAt") AS "at"
      FROM "Version" v
      JOIN "Task" t ON t.id = v."taskId"
      JOIN "Shot" s ON s.id = t."shotId"
      WHERE s."sequenceId" = ANY(${ids})
        AND s."deletedAt" IS NULL AND s."hiddenAt" IS NULL AND v."deletedAt" IS NULL
      GROUP BY s."sequenceId"
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT s."sequenceId" AS "id", MAX(m."createdAt") AS "at"
      FROM "MediaObject" m
      JOIN "Version" v ON v.id = m."versionId"
      JOIN "Task" t ON t.id = v."taskId"
      JOIN "Shot" s ON s.id = t."shotId"
      WHERE s."sequenceId" = ANY(${ids})
        AND s."deletedAt" IS NULL AND s."hiddenAt" IS NULL
        AND v."deletedAt" IS NULL AND m."deletedAt" IS NULL
      GROUP BY s."sequenceId"
    `,
  ]);
  return mergeLatest(rows, [shots, tasks, versions, medias]);
}

/**
 * Activity of an asset — two attachment paths.
 *
 * A version hangs from a task of the asset **or** from the asset itself (`Version` carries a parent XOR, see
 * `awaitingReviewByAsset`). Following only one would leave half the deliveries out of the calculation,
 * depending on how the studio publishes.
 */
export async function activityByAsset(rows: FreshnessRow[]): Promise<Map<number, Date>> {
  if (rows.length === 0) return new Map();
  const ids = rows.map((r) => r.id);
  const [tasks, versions, medias] = await Promise.all([
    prisma.$queryRaw<LatestRow[]>`
      SELECT "assetId" AS "id", MAX("updatedAt") AS "at"
      FROM "Task"
      WHERE "assetId" = ANY(${ids})
      GROUP BY "assetId"
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT COALESCE(v."assetId", t."assetId") AS "id", MAX(v."updatedAt") AS "at"
      FROM "Version" v
      LEFT JOIN "Task" t ON t.id = v."taskId"
      WHERE COALESCE(v."assetId", t."assetId") = ANY(${ids}) AND v."deletedAt" IS NULL
      GROUP BY 1
    `,
    prisma.$queryRaw<LatestRow[]>`
      SELECT COALESCE(v."assetId", t."assetId") AS "id", MAX(m."createdAt") AS "at"
      FROM "MediaObject" m
      JOIN "Version" v ON v.id = m."versionId"
      LEFT JOIN "Task" t ON t.id = v."taskId"
      WHERE COALESCE(v."assetId", t."assetId") = ANY(${ids})
        AND v."deletedAt" IS NULL AND m."deletedAt" IS NULL
      GROUP BY 1
    `,
  ]);
  return mergeLatest(rows, [tasks, versions, medias]);
}
