// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from 'express';
import { z } from 'zod';
import { MediaStatus, type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { pickMostAdvanced } from '../../lib/pipelineOrder';
import { resolveProjectSettingsById } from '../../lib/projectSettings';
import { versionSelect, mediaSelect, toVersion, toMedia } from '../../lib/v1Resources';
import { DEFAULT_URL_TTL, toMediaWithUrl } from './mediaAccess';

/**
 * "What is the latest version?": the question every DCC script asks before opening a shot, which
 * API v1 could not answer.
 *
 * The rule matches the rest of the product (`lib/pipelineOrder`): the most advanced pipe step that
 * has something to show, then the most recent one at that step. On a task, where the step is
 * constant, this reduces to "the most recent"; but on a shot, the published animation must never
 * win over the compositing.
 *
 * An elected version always carries a visible media: a "latest version" without a file is useless
 * to a caller who wants to download something.
 */

/** Search parent: a task, a shot or an asset, never two. */
export type LatestTarget = { taskId: number } | { shotId: number } | { assetId: number };

export const latestQuery = z.object({
  /** `false` includes drafts, which is what an artist re-reading their own work wants. */
  published: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .prefault('true'),
  /** `true` attaches a presigned URL to each media: one call instead of two per file. */
  urls: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .prefault('false'),
  expiresIn: z.coerce.number().int().min(60).max(86_400).default(DEFAULT_URL_TTL),
  /** Restricts the election to one pipe step (`comp`, `anim`...), by department key. */
  department: z.string().trim().max(80).optional(),
});

export type LatestOptions = z.infer<typeof latestQuery> & { projectId: number; viewerId: number };

/**
 * What makes a media visible to the caller.
 *
 * `published=false` opens drafts, but only the caller's own: across the product an unpublished
 * media belongs only to whoever uploaded it (see `MediaService.getUrl`). Without this filter a
 * project member would read their colleagues' work in progress, download URLs included.
 */
const mediaFilter = (opts: { published: boolean; viewerId: number }): Prisma.MediaObjectWhereInput =>
  opts.published
    ? { deletedAt: null, published: true, status: MediaStatus.READY }
    : { deletedAt: null, OR: [{ published: true }, { uploaderId: opts.viewerId }] };

const parentFilter = (target: LatestTarget): Prisma.VersionWhereInput => {
  if ('taskId' in target) return { taskId: target.taskId };
  if ('shotId' in target) return { task: { shotId: target.shotId } };
  // An asset carries versions through its tasks, and sometimes directly (legacy).
  return { OR: [{ task: { assetId: target.assetId } }, { assetId: target.assetId }] };
};

/**
 * Elects the version. Only what the ranking needs is loaded (identifier, date and step); then only
 * the winner is re-read. A production task can hold fifty versions: there is no reason to fetch
 * them all.
 */
async function electVersionId(target: LatestTarget, opts: LatestOptions): Promise<number | null> {
  const rows = await prisma.version.findMany({
    where: {
      ...parentFilter(target),
      deletedAt: null,
      ...(opts.published ? { published: true } : {}),
      media: { some: mediaFilter(opts) },
    },
    select: { id: true, createdAt: true, task: { select: { department: true } } },
  });
  const scoped = opts.department
    ? rows.filter((r) => (r.task?.department ?? '').toLowerCase() === opts.department?.toLowerCase())
    : rows;
  if (scoped.length === 0) return null;

  const { departments } = await resolveProjectSettingsById(opts.projectId);
  const winner = pickMostAdvanced(
    scoped.map((r) => ({ id: r.id, at: r.createdAt, department: r.task?.department ?? null })),
    departments,
  );
  return winner?.id ?? null;
}

/**
 * The elected version, as the v1 contract returns it: a `version` resource, its visible media and,
 * on request, each media's URL. Nothing more than an enriched `GET /versions/:id`, so a client does
 * not have to learn a second shape.
 */
export async function respondLatest(target: LatestTarget, opts: LatestOptions) {
  const versionId = await electVersionId(target, opts);
  if (versionId === null) {
    throw notFound('No version with a readable media here', 'NO_LATEST_VERSION');
  }
  const row = await prisma.version.findUnique({
    where: { id: versionId },
    select: {
      ...versionSelect,
      media: {
        where: mediaFilter(opts),
        orderBy: { createdAt: 'asc' },
        select: { ...mediaSelect, storageKey: true, metadata: true },
      },
    },
  });
  if (!row) throw notFound('Version not found');

  const base = toVersion(row);
  const media = opts.urls
    ? await Promise.all(row.media.map((m) => toMediaWithUrl(m, opts.expiresIn)))
    : row.media.map(toMedia);
  return { version: { ...base, media } };
}

/** Re-reads the typed query (Express 5) and adds the missing context: project and reader. */
export const latestOptions = (req: Request, projectId: number): LatestOptions => ({
  ...latestQuery.parse(req.query),
  projectId,
  viewerId: req.user!.id,
});
