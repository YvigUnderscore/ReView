// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { storage } from '../services/StorageService';
import { logger } from './logger';

/**
 * Purge of obsolete derivatives (37.H): versions beyond the N latest of each task/asset lose their HLS
 * renditions and timeline sprite — the MP4 proxy and the thumbnail stay, so playback remains possible
 * (at proxy quality). Configurable (Setting `derived_purge`), triggerable by hand (admin) and run daily.
 */

export interface DerivedPurgeConfig {
  enabled: boolean;
  keepVersions: number; // N most recent versions kept intact per task/asset
}

const PURGE_KEY = 'derived_purge';
const FALLBACK: DerivedPurgeConfig = { enabled: false, keepVersions: 3 };

function sanitize(raw: unknown, base: DerivedPurgeConfig): DerivedPurgeConfig {
  const o = (raw ?? {}) as Partial<DerivedPurgeConfig>;
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    keepVersions: Number.isFinite(o.keepVersions)
      ? Math.min(Math.max(Math.round(Number(o.keepVersions)), 1), 100)
      : base.keepVersions,
  };
}

export const derivedPurgeSchema = z.object({
  enabled: z.boolean().optional(),
  keepVersions: z.number().int().min(1).max(100).optional(),
});

export async function getDerivedPurgeConfig(): Promise<DerivedPurgeConfig> {
  const row = await prisma.setting.findUnique({ where: { key: PURGE_KEY } });
  if (!row) return FALLBACK;
  try {
    return sanitize(JSON.parse(row.value), FALLBACK);
  } catch {
    return FALLBACK;
  }
}

export async function setDerivedPurgeConfig(value: unknown): Promise<DerivedPurgeConfig> {
  const clean = sanitize(value, FALLBACK);
  await prisma.setting.upsert({
    where: { key: PURGE_KEY },
    update: { value: JSON.stringify(clean) },
    create: { key: PURGE_KEY, value: JSON.stringify(clean) },
  });
  return clean;
}

/** Version ids to purge: everything except the N most recent of each group (pure, tested). */
export function selectObsoleteVersionIds(
  versions: { id: number; taskId: number | null; assetId: number | null }[],
  keep: number,
): number[] {
  const groups = new Map<string, number[]>();
  for (const v of versions) {
    const key = v.taskId != null ? `t${v.taskId}` : v.assetId != null ? `a${v.assetId}` : `v${v.id}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(v.id);
  }
  const out: number[] = [];
  for (const ids of groups.values()) {
    ids.sort((a, b) => b - a);
    out.push(...ids.slice(keep));
  }
  return out;
}

/**
 * Number of PARENTS (tasks, then assets) processed per batch.
 *
 * WHY this split rather than another: the group of `selectObsoleteVersionIds` IS the parent
 * (`t{taskId}` or `a{assetId}`), and the `Version_parent_xor` constraint guarantees that a version has
 * exactly one. Splitting by parents therefore yields EXACTLY the same set of obsolete ids as a global
 * load — which would not hold for a split by version id, which would cut a group in two and "keep" N
 * versions in each half. Measured: the global load fetched the whole table (20,000 versions = 5.4 MB of
 * heap for ONE project; twenty projects = 110 MB in one block, in the process that also runs FFmpeg).
 */
const PURGE_PARENT_BATCH = 200;

/** Version ids passed at once in an `IN (…)` — an unbounded list is an unbounded query plan. */
const PURGE_VERSION_IN_BATCH = 500;

/**
 * Ceiling of slimmed media per pass. Each item costs two MinIO calls **and** a write: emptying a feature
 * film's backlog in one go would occupy the worker while the studio works. The purge is idempotent and
 * resumes on the next pass — same reasoning as `TRASH_PURGE_MAX_ITEMS` (lib/trash.ts).
 */
export const DERIVED_PURGE_MAX_ITEMS = 2000;

/** Splits a list into slices of at most `size` items (order kept). */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * A page of parent ids having at least one live version, in ascending id order.
 * The only criterion is "at least one live version" — exactly what the global load saw, which did not
 * check either whether the task/asset was in the trash.
 */
async function parentIdsWithLiveVersions(
  parent: 'task' | 'asset',
  after: number | undefined,
): Promise<number[]> {
  const where = { versions: { some: { deletedAt: null } } };
  const page = {
    select: { id: true },
    orderBy: { id: 'asc' as const },
    take: PURGE_PARENT_BATCH,
    ...(after !== undefined ? { skip: 1, cursor: { id: after } } : {}),
  };
  const rows =
    parent === 'task'
      ? await prisma.task.findMany({ where, ...page })
      : await prisma.asset.findMany({ where, ...page });
  return rows.map((r) => r.id);
}

/** Slims a media (HLS + sprite) if it still carries derivatives. `false` = nothing to do. */
async function purgeOneMedia(m: { id: number; metadata: unknown }): Promise<boolean> {
  const meta = { ...((m.metadata ?? {}) as Record<string, unknown>) };
  if (meta.hlsPurged === true || (!meta.hls && !meta.timelineSprite)) return false;
  const sprite = meta.timelineSprite as { key?: string } | undefined;
  // The two deletions are independent: awaiting one after the other doubled the MinIO latency per media
  // for no ordering benefit.
  await Promise.all([
    storage.deletePrefix(`derived/${m.id}/hls/`).catch(() => undefined),
    sprite?.key ? storage.deleteObject(sprite.key).catch(() => undefined) : Promise.resolve(),
  ]);
  delete meta.hls;
  delete meta.timelineSprite;
  meta.hlsPurged = true;
  await prisma.mediaObject.update({
    where: { id: m.id },
    data: { metadata: meta as Prisma.InputJsonValue },
  });
  return true;
}

/** Slims the videos attached to these versions, within the budget. */
async function purgeDerivedForVersions(versionIds: number[], budget: number): Promise<number> {
  let purged = 0;
  for (const ids of chunk(versionIds, PURGE_VERSION_IN_BATCH)) {
    if (purged >= budget) break;
    const media = await prisma.mediaObject.findMany({
      where: { versionId: { in: ids }, kind: 'VIDEO', deletedAt: null },
      select: { id: true, metadata: true },
      // Stable order: without it, an exhausted budget would leave a different remainder on each pass and
      // the purge could run forever without finishing the same piece of work.
      orderBy: { id: 'asc' },
    });
    for (const m of media) {
      if (purged >= budget) break;
      if (await purgeOneMedia(m)) purged += 1;
    }
  }
  return purged;
}

/**
 * Runs the purge (idempotent). Returns the number of media slimmed.
 *
 * The sweep is done parent by parent, in batches: for an equal configuration, the set of slimmed media is
 * identical to that of the "everything in memory" version (see the equivalence test); only the path to get
 * there is bounded.
 */
export async function purgeObsoleteDerived(
  maxItems: number = DERIVED_PURGE_MAX_ITEMS,
): Promise<{ purged: number }> {
  const cfg = await getDerivedPurgeConfig();
  if (!cfg.enabled) return { purged: 0 };

  let purged = 0;
  let budget = Math.max(0, Math.trunc(maxItems));

  for (const parent of ['task', 'asset'] as const) {
    let after: number | undefined;
    while (budget > 0) {
      const parents = await parentIdsWithLiveVersions(parent, after);
      if (parents.length === 0) break;
      after = parents[parents.length - 1];
      const versions = await prisma.version.findMany({
        // `taskId: null` on the asset side: a version carrying a task is grouped by task
        // (priority of `selectObsoleteVersionIds`) — without this filter it would be counted twice.
        where:
          parent === 'task'
            ? { deletedAt: null, taskId: { in: parents } }
            : { deletedAt: null, taskId: null, assetId: { in: parents } },
        select: { id: true, taskId: true, assetId: true },
      });
      const obsolete = selectObsoleteVersionIds(versions, cfg.keepVersions);
      if (obsolete.length > 0) {
        const done = await purgeDerivedForVersions(obsolete, budget);
        purged += done;
        budget -= done;
      }
      if (parents.length < PURGE_PARENT_BATCH) break;
    }
  }

  if (purged > 0) logger.info(`[derivedPurge] ${purged} média(s) allégé(s) (HLS + sprite retirés)`);
  return { purged };
}

export const __testing = { sanitize, FALLBACK, PURGE_PARENT_BATCH, PURGE_VERSION_IN_BATCH };
