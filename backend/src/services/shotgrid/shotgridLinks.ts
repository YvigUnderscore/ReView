// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma, ShotgridLink } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { conflict } from '../../lib/errors';
import { ignoreFailure } from '../../lib/ignoreFailure';

/**
 * Local <-> ShotGrid correspondence table.
 *
 * Every imported entity leaves a row there: it is what makes imports idempotent (re-synchronizing duplicates nothing), what allows finding the remote entity of a
 * ReView object for writing, and what carries the ShotGrid fields with no local equivalent (duration in minutes, non-member assignees, publish paths).
 *
 * **Lifetime of a link.** The table is polymorphic (`localType` + `localId`): no foreign key can attach it to the twelve models it designates, hence no
 * `ON DELETE CASCADE`. The purge is entrusted to **PostgreSQL triggers** (`AFTER DELETE`, migration `20260908090000_shotgrid_liens_fiables`), for two reasons
 * that no application code could cover:
 *
 * 1. most deletions do not exist in TypeScript — deleting a shot erases its tasks, versions, media and comments **by SQL cascade**, without any service seeing them go by;
 * 2. a trigger runs within the deletion's transaction: the link cannot survive a millisecond beyond what it designates, nor a rollback.
 *
 * Nothing to call from a service, then: deleting the entity is enough. What follows only deals with setting and reading the correspondences.
 */

/**
 * Local types that a correspondence can carry, **enumerated at runtime**.
 *
 * The list is not just a type: it is what `shotgridLinkPurge.test.ts` confronts with the SQL triggers that purge the links of a deleted entity.
 * Adding a type here without adding its trigger makes the suite fail — it is the only safeguard against the return of orphan links, the table being polymorphic
 * (`localType` + `localId`) and therefore out of reach of a foreign key.
 */
export const LOCAL_TYPES = [
  'episode',
  'sequence',
  'shot',
  'asset',
  'task',
  'version',
  'media',
  'pipelineStatus',
  'reviewStatus',
  'user',
  'playlist',
  'comment',
] as const;

export type LocalType = (typeof LOCAL_TYPES)[number];

export interface LinkData {
  [key: string]: unknown;
}

export async function findBySg(
  connectionId: number,
  sgType: string,
  sgId: number,
): Promise<ShotgridLink | null> {
  return prisma.shotgridLink.findUnique({
    where: { connectionId_sgType_sgId: { connectionId, sgType, sgId } },
  });
}

export async function findByLocal(
  connectionId: number,
  localType: LocalType,
  localId: number,
): Promise<ShotgridLink | null> {
  return prisma.shotgridLink.findUnique({
    where: { connectionId_localType_localId: { connectionId, localType, localId } },
  });
}

/**
 * ShotGrid identifiers of a batch of local entities — avoids N queries in a loop.
 *
 * Deliberately **unbounded**, unlike `listForUi`: the synchronization uses it to know what is already linked. A link absent from the table reads there as "entity never
 * imported" and triggers a creation on the remote site — truncating the map would duplicate shots at the client. It is called by a job, not by a screen.
 */
export async function mapLocalToSg(
  connectionId: number,
  localType: LocalType,
): Promise<Map<number, ShotgridLink>> {
  const links = await prisma.shotgridLink.findMany({ where: { connectionId, localType } });
  return new Map(links.map((l) => [l.localId, l]));
}

/** The reverse direction, unbounded for the same reason as `mapLocalToSg`. */
export async function mapSgToLocal(
  connectionId: number,
  localType: LocalType,
): Promise<Map<number, ShotgridLink>> {
  const links = await prisma.shotgridLink.findMany({ where: { connectionId, localType } });
  return new Map(links.map((l) => [l.sgId, l]));
}

/**
 * Sets or refreshes a correspondence.
 *
 * The pair (connection, remote entity) and the pair (connection, local entity) are both unique: an entity cannot be linked twice, in either direction. An old link that has
 * become inconsistent is **replaced** — but no longer silently, and no longer at any price:
 *
 * - **Legitimate rewiring** (same `localType`): a ReView shot changes remote entity — the shot was recreated on the site with a new identifier — or a remote entity changes
 *   local counterpart. The previous link goes, but a `warn` says so: the abandoned shot becomes "never imported" again, and the next pass will recreate it at the client.
 *   A trace is the minimum needed to understand the duplicate.
 * - **Collision between types** (different `localType`): a ShotGrid identifier cannot designate both a media and a note at once. The replacement here was pure corruption —
 *   that is how a correct link got overwritten by the lying link `('Attachment', <Version id>)`. We refuse rather than obey: a false ShotGrid write cannot be undone; a red job
 *   is better than an invented link.
 *
 * All conflicts are removed, not only the first: a link can collide on BOTH sides at once (two distinct rows), and removing only one would leave the `upsert` stumbling on
 * the other unique constraint.
 */
export async function upsertLink(params: {
  connectionId: number;
  localType: LocalType;
  localId: number;
  sgType: string;
  sgId: number;
  sgUpdatedAt?: Date | null;
  data?: LinkData;
}): Promise<ShotgridLink> {
  const { connectionId, localType, localId, sgType, sgId, sgUpdatedAt, data } = params;

  const conflicting = await prisma.shotgridLink.findMany({
    where: {
      connectionId,
      OR: [
        { sgType, sgId, NOT: { localId, localType } },
        { localType, localId, NOT: { sgType, sgId } },
      ],
    },
  });

  const crossType = conflicting.find((c) => c.localType !== localType);
  if (crossType) {
    // Without an error code: none of this reaches a screen — the synchronization runs as a job, and it is the pass journal that will carry the message.
    throw conflict(
      `ShotGrid ${sgType}#${sgId} is already linked to ${crossType.localType}#${crossType.localId}, not to ${localType}#${localId}`,
    );
  }
  for (const stale of conflicting) {
    logger.warn(
      {
        connectionId,
        localType,
        from: { localId: stale.localId, sgType: stale.sgType, sgId: stale.sgId },
        to: { localId, sgType, sgId },
      },
      'shotgrid link rebound',
    );
    await prisma.shotgridLink.delete({ where: { id: stale.id } });
  }

  return prisma.shotgridLink.upsert({
    where: { connectionId_sgType_sgId: { connectionId, sgType, sgId } },
    create: {
      connectionId,
      localType,
      localId,
      sgType,
      sgId,
      sgUpdatedAt: sgUpdatedAt ?? null,
      data: (data ?? {}) as Prisma.InputJsonValue,
      syncedAt: new Date(),
    },
    update: {
      localType,
      localId,
      sgUpdatedAt: sgUpdatedAt ?? null,
      ...(data !== undefined ? { data: data as Prisma.InputJsonValue } : {}),
      syncedAt: new Date(),
    },
  });
}

export async function removeLink(connectionId: number, sgType: string, sgId: number): Promise<void> {
  await prisma.shotgridLink
    .delete({ where: { connectionId_sgType_sgId: { connectionId, sgType, sgId } } })
    .catch(ignoreFailure('[shotgrid] link delete failed', { connectionId, sgType, sgId }));
}

/** Ancillary data of a link, typed for its use. */
export function linkData<T extends LinkData>(link: ShotgridLink | null | undefined): Partial<T> {
  if (!link || typeof link.data !== 'object' || link.data === null) return {};
  return link.data as Partial<T>;
}

/** ShotGrid fields kept on a task for lack of an equivalent in the ReView model. */
export interface TaskLinkData extends LinkData {
  durationMinutes?: number | null;
  stepName?: string | null;
  /** ShotGrid assignees without a ReView account: displayed greyed out, never invented. */
  sgAssignees?: Array<{ id: number; name: string; email: string | null }>;
  sgStatusCode?: string | null;
}

/**
 * Marker of the thumbnail fetched from the site (see `ShotgridThumbnails`).
 *
 * It is the address of the image, signature removed: addressed by content, so stable as long as the thumbnail does not change. Its presence also says that the local
 * thumbnail comes from the site — otherwise an image dropped by hand in ReView would be erased by the first shot that ShotGrid does not illustrate.
 */
export interface ThumbnailLinkData extends LinkData {
  sgThumbSrc?: string | null;
}

/** A sequence has nothing else to keep outside the model: its thumbnail, and that is all. */
export type SequenceLinkData = ThumbnailLinkData;

export interface ShotLinkData extends ThumbnailLinkData {
  sgStatusCode?: string | null;
  cutDuration?: number | null;
}

export interface AssetLinkData extends ThumbnailLinkData {
  sgAssetType?: string | null;
  sgStatusCode?: string | null;
}

export interface VersionLinkData extends LinkData {
  sgStatusCode?: string | null;
  sgPathToMovie?: string | null;
  sgFirstFrame?: number | null;
  sgLastFrame?: number | null;
  mediaImported?: boolean;
  /** Version born in ReView then pushed: its media comes from here, not from the site. */
  createdFromReview?: boolean;
  /** Attached pipeline publishes (file paths, read-only). */
  publishedFiles?: Array<{
    id: number;
    name: string;
    path: string | null;
    type: string | null;
    version: number | null;
  }>;
}

/** Correspondence types from which the interface draws a badge or a direct link. */
export const UI_LINK_TYPES: readonly LocalType[] = ['sequence', 'shot', 'asset', 'task', 'version'];

/**
 * Cap on the correspondence table served to the interface.
 *
 * The query was not bounded: at the targeted volume (2,000 shots, 10,000 tasks, 20,000 versions) it returned several megabytes of JSON on every project opening.
 * The cap lets through all the "card" types — sequences, shots, assets, tasks — and only trims the versions: sorting by `localType` places them last (alphabetical order), so
 * the degradation first touches what is displayed the least.
 */
export const UI_LINKS_LIMIT = 20000;

/**
 * A project's correspondences, as the interface consumes them.
 *
 * `sgType` and `syncedAt` accompany each link: the first allows realigning an entity without asking which ShotGrid type it is, the second says since when it was not
 * re-read. A single query thus serves the direct links AND the alignment state — a list of two hundred shots does not trigger two hundred of them.
 *
 * `localTypes` lets a screen request only what it displays (the page of a shot has no use for the project's twenty thousand versions).
 */
export async function listForUi(
  connectionId: number,
  opts: { localTypes?: readonly LocalType[]; limit?: number } = {},
) {
  const limit = Math.min(Math.max(1, opts.limit ?? UI_LINKS_LIMIT), UI_LINKS_LIMIT);
  const links = await prisma.shotgridLink.findMany({
    where: {
      connectionId,
      localType: { in: [...(opts.localTypes ?? UI_LINK_TYPES)] },
    },
    orderBy: [{ localType: 'asc' }, { localId: 'asc' }],
    take: limit,
    select: { localType: true, localId: true, sgId: true, sgType: true, syncedAt: true },
  });
  if (links.length >= limit) {
    // A missing badge reads as "this entity is not linked": one must be able to trace back to the truncation rather than to an imagined desynchronization.
    logger.warn({ connectionId, limit }, 'shotgrid links truncated for UI');
  }
  return links;
}

/**
 * Should this version's media be fetched?
 *
 * Written as a named rule rather than as a dissolved condition, because forgetting it cost a visible defect: a version published from ReView had its own file re-downloaded
 * from the site at the next synchronization and added to the same version — one more copy at every pass.
 */
export function shouldImportMedia(params: {
  withMedia: boolean;
  autoImport: boolean;
  link: VersionLinkData;
}): boolean {
  if (!params.withMedia || !params.autoImport) return false;
  if (params.link.mediaImported) return false;
  // What we would read on the site is the file we sent there.
  if (params.link.createdFromReview) return false;
  return true;
}
