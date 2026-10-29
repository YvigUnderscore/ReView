// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';

/**
 * Catalogue of the versions that can be put into a playlist (C5).
 *
 * There was no reusable entity search: the palette's caps at five results per type and ignores versions.
 * Building a dailies playlist therefore required opening each shot one by one
 * and clicking "add".
 *
 * A version hangs from a task (itself under a shot or an asset) or directly from an asset: all three paths
 * are covered, otherwise a whole section of the project remains unfindable depending on how the studio files
 * its work.
 */

export interface CandidateQuery {
  q?: string;
  sequenceId?: number | 'none';
  /** Department key, as the task denormalises it. */
  department?: string;
  /** Keep only the latest version of each task — the ordinary case for dailies. */
  latestOnly?: boolean;
  limit?: number;
}

export interface Candidate {
  versionId: number;
  name: string;
  /** Readable location: "SQ010 · SH020 › comp". */
  location: string;
  sequenceId: number | null;
  department: string | null;
  createdAt: string;
  reviewStatus: { id: number; name: string; color: string } | null;
  media: { id: number; kind: string; originalName: string; thumbnailUrl: string | null } | null;
}

function ownedByProject(projectId: number): Prisma.VersionWhereInput {
  return {
    // `hiddenAt`: the work of a hidden item is not offered to dailies. Without this filter, a shot removed
    // from all screens reappeared in the choice of versions of a playlist —
    // that is to say, in the projection, in front of the client.
    OR: [
      { task: { shot: { projectId, hiddenAt: null } } },
      { task: { asset: { projectId, hiddenAt: null } } },
      { asset: { projectId, hiddenAt: null } },
    ],
  };
}

/** Versions of the project, filtered, with what is needed to recognise them at a glance. */
export async function list(
  projectId: number,
  viewerId: number,
  query: CandidateQuery = {},
): Promise<Candidate[]> {
  const limit = query.limit ?? 100;
  const filters: Prisma.VersionWhereInput[] = [ownedByProject(projectId)];

  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const };
    filters.push({
      OR: [
        { name: contains },
        { task: { name: contains } },
        { task: { shot: { code: contains } } },
        { task: { asset: { name: contains } } },
        { asset: { name: contains } },
      ],
    });
  }
  if (query.sequenceId === 'none') filters.push({ task: { shot: { sequenceId: null } } });
  else if (typeof query.sequenceId === 'number')
    filters.push({ task: { shot: { sequenceId: query.sequenceId } } });
  if (query.department) filters.push({ task: { department: query.department } });

  const versions = await prisma.version.findMany({
    where: { deletedAt: null, AND: filters },
    orderBy: { createdAt: 'desc' },
    // The "latest first" sort does not survive the filtering by task: we take wide, then elect. The final cut
    // is made afterwards.
    take: query.latestOnly ? limit * 4 : limit,
    select: {
      id: true,
      name: true,
      createdAt: true,
      taskId: true,
      reviewStatus: { select: { id: true, name: true, color: true } },
      task: {
        select: {
          name: true,
          department: true,
          shot: { select: { code: true, sequenceId: true, sequence: { select: { code: true } } } },
          asset: { select: { name: true } },
        },
      },
      asset: { select: { name: true } },
      media: {
        // Same visibility rule as everywhere: published, or uploaded by the requester.
        where: { deletedAt: null, status: 'READY', OR: [{ published: true }, { uploaderId: viewerId }] },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { id: true, kind: true, originalName: true, thumbnailKey: true },
      },
    },
  });

  const kept = query.latestOnly ? keepLatestPerTask(versions) : versions;

  return Promise.all(
    kept.slice(0, limit).map(async (v) => {
      const t = v.task;
      const location = t?.shot
        ? `${t.shot.sequence ? `${t.shot.sequence.code} · ` : ''}${t.shot.code} › ${t.name}`
        : t?.asset
          ? `${t.asset.name} › ${t.name}`
          : (v.asset?.name ?? '');
      const first = v.media[0] ?? null;
      return {
        versionId: v.id,
        name: v.name,
        location,
        sequenceId: t?.shot?.sequenceId ?? null,
        department: t?.department ?? null,
        createdAt: v.createdAt.toISOString(),
        reviewStatus: v.reviewStatus,
        media: first
          ? {
              id: first.id,
              kind: first.kind,
              originalName: first.originalName,
              thumbnailUrl: first.thumbnailKey ? await storage.getPresignedGetUrl(first.thumbnailKey) : null,
            }
          : null,
      };
    }),
  );
}

/** The list is already sorted from most recent to oldest: the first version seen per task wins. */
function keepLatestPerTask<T extends { id: number; taskId: number | null }>(versions: T[]): T[] {
  const seen = new Set<number>();
  return versions.filter((v) => {
    // A version attached directly to an asset has no task: it is always kept, otherwise a whole section of
    // the catalogue would disappear from the search.
    if (v.taskId === null) return true;
    if (seen.has(v.taskId)) return false;
    seen.add(v.taskId);
    return true;
  });
}
