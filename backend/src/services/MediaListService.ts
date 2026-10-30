// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { checkProjectAccess } from '../middleware/rbac';
import { storage } from '../lib/storage';
import { resolveProjectSettingsById } from '../lib/projectSettings';
import { forbidden } from '../lib/errors';
import { type PaginationParams, type Paginated, pageArgs, paginate } from '../lib/pagination';
import { mediaViewKey, type SessionUser } from './mediaShared';

/** Media libraries: published media of a project, the global Reviews page, a user's drafts. */

/**
 * Number of signed lines in a row before yielding back to the event loop.
 *
 * WHY: `getSignedUrl` returns a promise, but SigV4 signing is a chain of HMAC-SHA256 steps
 * that resolve in microtasks, so the loop never gets a turn between two signatures. Measured
 * with the project's presigner: 1000 signatures take 164 ms with zero loop turns, during which
 * no other request is served. A library page signs two per media; at `pageSize=500` (reachable
 * with a plain URL parameter) that is 1000 signatures in one block. Hence a real loop turn
 * every 25 lines.
 */
const SIGN_YIELD_EVERY = 25;

/** Yields to the event loop: `setImmediate` is the only point that lets pending I/O through. */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * `Promise.all(rows.map(build))`, but in slices, with an event-loop turn between each.
 *
 * The result is strictly identical: same rows, same order, same values. Only concurrency
 * changes (25 builds at a time instead of all of them). Total CPU cost is unchanged; what
 * disappears is the head-of-line blocking for the other callers of the process.
 */
async function mapYieldingToEventLoop<T, R>(rows: readonly T[], build: (row: T) => Promise<R>): Promise<R[]> {
  if (rows.length <= SIGN_YIELD_EVERY) return Promise.all(rows.map(build));
  const out: R[] = [];
  for (let i = 0; i < rows.length; i += SIGN_YIELD_EVERY) {
    if (i > 0) await yieldToEventLoop();
    out.push(...(await Promise.all(rows.slice(i, i + SIGN_YIELD_EVERY).map(build))));
  }
  return out;
}

/** Paginated library: published media (READY) of a project, with presigned URLs. */
export async function listPublished(
  user: SessionUser,
  projectId: number,
  kind: MediaKind | undefined,
  p: PaginationParams,
): Promise<Paginated<unknown>> {
  if (!(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
  const where = {
    published: true,
    deletedAt: null,
    status: MediaStatus.READY,
    ...(kind ? { kind } : {}),
    version: {
      OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
    },
  };
  const [media, total] = await Promise.all([
    prisma.mediaObject.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(p) }),
    prisma.mediaObject.count({ where }),
  ]);
  const items = await mapYieldingToEventLoop(media, async (m) => ({
    id: m.id,
    kind: m.kind,
    originalName: m.originalName,
    thumbnailUrl: m.thumbnailKey ? await storage.getPresignedGetUrl(m.thumbnailKey) : null,
    // Displayable key: an EXR library would otherwise return URLs that nothing can render.
    url: await storage.getPresignedGetUrl(mediaViewKey(m)),
  }));
  return paginate(items, total, p);
}

export interface ReviewsFilter {
  projectId?: number;
  kind?: MediaKind;
  status?: 'published' | 'draft';
  /** Filter by current review decision: a ReviewStatus id, or 'none' for no decision. */
  decision?: number | 'none';
  /** 'me' = versions whose review was assigned to me (Phase 49); the assignment panel uses it. */
  assigned?: 'me';
}

/**
 * Global "Reviews" page (12.C): published media (READY) of all my projects plus my own
 * drafts, across projects by membership (ADMIN/SUPERVISOR see everything), filterable by
 * project, type and status, sorted newest first.
 */
export async function listReviews(
  user: SessionUser,
  filter: ReviewsFilter,
  p: PaginationParams,
): Promise<Paginated<unknown>> {
  const isGlobal = user.role === Role.ADMIN || user.role === Role.SUPERVISOR;
  const project: Prisma.ProjectWhereInput = {
    deletedAt: null,
    ...(filter.projectId ? { id: filter.projectId } : {}),
    ...(isGlobal ? {} : { memberships: { some: { userId: user.id } } }),
  };
  // Visibility: drafts are only shown to their uploader (same semantics as getDetail).
  const visibility: Prisma.MediaObjectWhereInput =
    filter.status === 'draft'
      ? { published: false, uploaderId: user.id }
      : filter.status === 'published'
        ? { published: true }
        : { OR: [{ published: true }, { published: false, uploaderId: user.id }] };
  const where: Prisma.MediaObjectWhereInput = {
    deletedAt: null,
    status: MediaStatus.READY,
    ...(filter.kind ? { kind: filter.kind } : {}),
    version: {
      deletedAt: null,
      ...(filter.decision === 'none'
        ? { reviewStatusId: null }
        : filter.decision !== undefined
          ? { reviewStatusId: filter.decision }
          : {}),
      // Reviews assigned to me (Phase 49). The filter applies to the version, not the media:
      // it is the delivery that is assigned, and it often contains several.
      ...(filter.assigned === 'me' ? { reviewers: { some: { reviewerId: user.id } } } : {}),
      OR: [
        { task: { shot: { deletedAt: null, project } } },
        { task: { asset: { deletedAt: null, project } } },
        { asset: { deletedAt: null, project } },
      ],
    },
    AND: [visibility],
  };
  const projectSelect = { select: { id: true, name: true } };
  const [media, total] = await Promise.all([
    prisma.mediaObject.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...pageArgs(p),
      include: {
        uploader: { select: { id: true, name: true } },
        version: {
          select: {
            name: true,
            reviewStatus: { select: { id: true, name: true, color: true } },
            task: {
              select: {
                name: true,
                shot: {
                  select: { code: true, sequence: { select: { code: true } }, project: projectSelect },
                },
                asset: { select: { name: true, project: projectSelect } },
              },
            },
            asset: { select: { name: true, project: projectSelect } },
          },
        },
      },
    }),
    prisma.mediaObject.count({ where }),
  ]);
  const items = await mapYieldingToEventLoop(media, async (m) => {
    const t = m.version?.task;
    const location = t?.shot
      ? `${t.shot.sequence ? t.shot.sequence.code + ' · ' : ''}${t.shot.code} › ${t.name}`
      : t?.asset
        ? `${t.asset.name} › ${t.name}`
        : (m.version?.asset?.name ?? '');
    const project = t?.shot?.project ?? t?.asset?.project ?? m.version?.asset?.project ?? null;
    // Thumbnail sprite for the hover preview of the cards (42.A, #78, video).
    const meta = (m.metadata ?? {}) as {
      timelineSprite?: { key: string; count: number; cols: number; rows: number };
    };
    const ts = m.kind === MediaKind.VIDEO ? meta.timelineSprite : undefined;
    return {
      id: m.id,
      kind: m.kind,
      name: m.originalName,
      published: m.published,
      createdAt: m.createdAt,
      thumbnailUrl: m.thumbnailKey ? await storage.getPresignedGetUrl(m.thumbnailKey) : null,
      hoverSprite: ts
        ? {
            url: await storage.getPresignedGetUrl(ts.key),
            count: ts.count,
            cols: ts.cols,
            rows: ts.rows,
          }
        : null,
      location,
      // The decision is set on the VERSION, not the media: without this identifier the Reviews
      // page could not change anything in bulk without one call per card.
      versionId: m.versionId,
      versionName: m.version?.name ?? '',
      reviewStatus: m.version?.reviewStatus ?? null,
      project,
      uploader: m.uploader?.name ?? null,
    };
  });
  return paginate(items, total, p);
}

/**
 * The user's drafts (unpublished), with a readable location.
 *
 * Each row also carries its project and the brief rule that applies to it: the "pending
 * drafts" badge is the second place from which one publishes, and publishing means saying
 * to whom it is delegated. Without these two fields the panel would need one call per draft
 * to know whether it can offer the action and under which constraint.
 */
export async function listDrafts(userId: number) {
  const drafts = await prisma.mediaObject.findMany({
    where: { published: false, deletedAt: null, uploaderId: userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      version: {
        select: {
          id: true,
          name: true,
          task: {
            select: {
              id: true,
              name: true,
              shot: { select: { code: true, projectId: true, sequence: { select: { code: true } } } },
              asset: { select: { name: true, projectId: true } },
            },
          },
          asset: { select: { name: true, projectId: true } },
        },
      },
    },
  });
  // Brief rules are read once per PROJECT, not once per draft: a hundred drafts from the same
  // production must not trigger a hundred settings resolutions, each going through the studio
  // defaults.
  const projectOf = (m: (typeof drafts)[number]) =>
    m.version?.task?.shot?.projectId ?? m.version?.task?.asset?.projectId ?? m.version?.asset?.projectId;
  const rules = new Map(
    await Promise.all(
      [...new Set(drafts.map(projectOf).filter((id): id is number => typeof id === 'number'))].map(
        async (id) => [id, (await resolveProjectSettingsById(id)).reviewRequest] as const,
      ),
    ),
  );
  return drafts.map((m) => {
    const v = m.version;
    const t = v?.task;
    let location = '';
    if (t?.shot)
      location = `${t.shot.sequence ? t.shot.sequence.code + ' · ' : ''}${t.shot.code} › ${t.name}`;
    else if (t?.asset) location = `${t.asset.name} › ${t.name}`;
    else if (v?.asset) location = v.asset.name;
    return {
      id: m.id,
      originalName: m.originalName,
      kind: m.kind,
      status: m.status,
      versionName: v?.name ?? '',
      location,
      createdAt: m.createdAt,
      // What is needed to assign the review without leaving the badge: the version, its project,
      // and what that project requires of a brief.
      versionId: m.versionId,
      projectId: projectOf(m) ?? null,
      reviewRequest: rules.get(projectOf(m) ?? -1) ?? null,
    };
  });
}
