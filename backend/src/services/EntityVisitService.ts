// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { VisitTargetType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  activityByAsset,
  activityBySequence,
  activityByShot,
  unseenFrom,
  type FreshnessRow,
} from '../lib/entityFreshness';

/**
 * The "not yet viewed" state (Phase 50, batch 9).
 *
 * A card lights up when the entity has changed since **this person** last opened it. Two dates are enough to
 * say so: the entity's activity — its own and that of its descendants, computed by `lib/entityFreshness` —
 * and the visit date, written here. Opening switches it off; any later change switches it back on.
 *
 * Everything is read **in batch**, for the whole page. A per-card variant would have required one visit query
 * and three aggregates per row, i.e. eight hundred round trips for a page of two hundred shots — the kind of
 * multiplication that has already been costly on these same lists.
 */

/** What each activity function can do: one family of entities, in batch. */
type ActivityReader = (rows: FreshnessRow[]) => Promise<Map<number, Date>>;

/** This person's visits, for this type, among these ids. One query for the page. */
export async function visitedAtFor(
  userId: number,
  targetType: VisitTargetType,
  ids: number[],
): Promise<Map<number, Date>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.entityVisit.findMany({
    where: { userId, targetType, targetId: { in: ids } },
    select: { targetId: true, visitedAt: true },
  });
  return new Map(rows.map((r) => [r.targetId, r.visitedAt]));
}

/** Marks an entity as viewed: the glow goes out. Idempotent — the date is overwritten. */
export async function markVisited(
  userId: number,
  targetType: VisitTargetType,
  targetId: number,
): Promise<Date> {
  const visitedAt = new Date();
  await prisma.entityVisit.upsert({
    where: { userId_targetType_targetId: { userId, targetType, targetId } },
    update: { visitedAt },
    create: { userId, targetType, targetId, visitedAt },
  });
  return visitedAt;
}

/**
 * "Mark everything as read": a single statement for the whole list.
 *
 * A per-card `upsert` would have required two thousand round trips on a feature film. `ON CONFLICT` inserts
 * and updates at once, and makes the gesture atomic: two simultaneous
 * clicks cannot collide on a uniqueness violation — which a `deleteMany` followed by a `createMany`, even in
 * a transaction, would not have guaranteed.
 *
 * Returns the number of rows written.
 */
export async function markManyVisited(
  userId: number,
  targetType: VisitTargetType,
  ids: number[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const visitedAt = new Date();
  return prisma.$executeRaw`
    INSERT INTO "EntityVisit" ("userId", "targetType", "targetId", "visitedAt")
    SELECT ${userId}, ${targetType}::"VisitTargetType", src.id, ${visitedAt}
    FROM unnest(${ids}::int[]) AS src(id)
    ON CONFLICT ("userId", "targetType", "targetId")
      DO UPDATE SET "visitedAt" = EXCLUDED."visitedAt"
  `;
}

/**
 * What "mark everything as read" covers: the live entities of a project, by type.
 *
 * The ids are established **by the server** from the project alone, never received from the client. A posted
 * list of ids would have required checking membership one by one — hence as many queries
 * as entities, and an opportunity to get it wrong. Here the authorization rests on a single project access
 * assertion, made in the route.
 *
 * Trashed or hidden items are excluded: they are in no list, and marking them read would write rows that
 * nobody will ever read back.
 */
export async function visitableIdsOfProject(
  projectId: number,
  targetType: VisitTargetType,
): Promise<number[]> {
  const alive = { projectId, deletedAt: null, hiddenAt: null };
  if (targetType === VisitTargetType.SHOT)
    return (await prisma.shot.findMany({ where: alive, select: { id: true } })).map((r) => r.id);
  if (targetType === VisitTargetType.SEQUENCE)
    return (await prisma.sequence.findMany({ where: alive, select: { id: true } })).map((r) => r.id);
  if (targetType === VisitTargetType.ASSET)
    return (await prisma.asset.findMany({ where: alive, select: { id: true } })).map((r) => r.id);
  // The other types do not yet have a list that lights them up: nothing to mark.
  return [];
}

/** Common factory: enables activity reading, and compares it with the visits. */
async function unseenBy(
  userId: number,
  targetType: VisitTargetType,
  rows: FreshnessRow[],
  activity: ActivityReader,
): Promise<Map<number, boolean>> {
  if (rows.length === 0) return new Map();
  const [dates, visits] = await Promise.all([
    activity(rows),
    visitedAtFor(
      userId,
      targetType,
      rows.map((r) => r.id),
    ),
  ]);
  return unseenFrom(dates, visits);
}

/** "This shot has moved since I opened it" — for the whole page. */
export function unseenByShot(userId: number, rows: FreshnessRow[]): Promise<Map<number, boolean>> {
  return unseenBy(userId, VisitTargetType.SHOT, rows, activityByShot);
}

/** Same for a sequence: its shots and their deliveries count as its activity. */
export function unseenBySequence(userId: number, rows: FreshnessRow[]): Promise<Map<number, boolean>> {
  return unseenBy(userId, VisitTargetType.SEQUENCE, rows, activityBySequence);
}

/** Same for an asset, including its two version attachment paths. */
export function unseenByAsset(userId: number, rows: FreshnessRow[]): Promise<Map<number, boolean>> {
  return unseenBy(userId, VisitTargetType.ASSET, rows, activityByAsset);
}
