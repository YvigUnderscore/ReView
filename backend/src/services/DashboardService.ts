// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, Role, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { familyOf, statusRefOf, taskPriority } from '../lib/statusFamily';
import {
  accessibleProjects,
  awaitingMyReviewWhere,
  commentFeedWhere,
  mediaInReviewWhere,
  myOpenTasksWhere,
  myRetakesWhere,
  publishedMediaInScope,
  versionInProjects,
  type SessionUser,
} from '../lib/homeScope';
import { storage } from './StorageService';
import { effectiveThumbnailUrl, firstMediaThumbKeysForProjects } from '../lib/thumbnails';

/**
 * Data for the Home page (12.B): latest commented reviews, activity feed, my assigned tasks and statistics —
 * all bounded to "my projects" (ADMIN/SUPERVISOR see everything, otherwise filter by membership, pattern
 * lib/search.ts).
 *
 * Three scaling fixes compared to the original version.
 *
 * "Latest reviews" fetched the whole studio Comment table only to display six rows — Prisma's `distinct` does
 * not exist in SQL. The election has been moved to the database (`latestCommentPerMedia` below).
 *
 * The progress of recent projects used to cost two correlated `count` PER project, i.e. ten queries out of
 * the twenty-three of the home page opening, for each user and at each display. A single aggregate replaces
 * them.
 *
 * And the counters reasoned on the frozen `TaskStatus` enum: a studio linked to ShotGrid saw "my retakes" and
 * the gauge of each project computed on six buckets that are not its vocabulary. They now read
 * `PipelineStatus` (`lib/statusFamily`), falling back on the enum when no customizable status is set.
 *
 * The four counters of the Home page are no longer written here: their scopes live in `lib/homeScope`, with
 * the pages the cards open. Each one lied in its own way — "my retakes" with no bound at all, "awaiting
 * review" presented as personal but computed for the whole studio, "media in review" counting the published
 * including the decided ones. A figure and the view that unfolds it now read the same `where`.
 */

/** Readable location of a task (SQ010 · SH020, or asset name). */
function loc(
  t: {
    shot?: { code: string; sequence?: { code: string } | null } | null;
    asset?: { name: string } | null;
  } | null,
): string {
  if (!t) return '';
  if (t.shot) return `${t.shot.sequence ? t.shot.sequence.code + ' · ' : ''}${t.shot.code}`;
  if (t.asset) return t.asset.name;
  return '';
}

const versionSelect = {
  select: {
    name: true,
    task: {
      select: {
        id: true,
        name: true,
        shot: { select: { code: true, sequence: { select: { code: true } } } },
        asset: { select: { name: true } },
      },
    },
    asset: { select: { name: true } },
  },
} as const;

/** Number of media shown in "Latest reviews". */
const LATEST_REVIEWS = 6;

/**
 * The last comment of each of the six most recently commented media.
 *
 * The original read combined `distinct: ['mediaObjectId']` and `take: 6`. Prisma 5 has no SQL translation for
 * `distinct`: it resolves it in the query engine, which also neutralizes the `take`. The emitted SQL
 * therefore went WITHOUT a `LIMIT` — the whole studio Comment table crossed the network, including the
 * `annotation`, `cameraState` and `attachments` columns, so that six rows could be kept. Measured at 50,000
 * comments: 40,038 rows fetched, 830 ms, on every home page opening of every account.
 *
 * The election therefore moves to SQL: a `GROUP BY "mediaObjectId"` aggregate sorted on `MAX("createdAt")`
 * with a real `LIMIT 6` (six rows fetched whatever the age of the studio), then a second read that fetches
 * those six comments and only the displayed columns.
 *
 * `commentWhere` is passed unchanged to both queries rather than rewritten in SQL: it is what bounds a CLIENT
 * to the notes meant for them, and an access scope described in two places eventually diverges — that would
 * be a leak, not an optimization.
 */
async function latestCommentPerMedia(commentWhere: Prisma.CommentWhereInput) {
  const latest = await prisma.comment.groupBy({
    by: ['mediaObjectId'],
    where: commentWhere,
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: 'desc' } },
    take: LATEST_REVIEWS,
  });
  // `createdAt` is never null and a group is never empty: the filter only makes the absence of a date
  // representable without an assertion.
  const pairs = latest.flatMap((g) =>
    g._max.createdAt ? [{ mediaObjectId: g.mediaObjectId, createdAt: g._max.createdAt }] : [],
  );
  if (pairs.length === 0) return [];
  const rows = await prisma.comment.findMany({
    where: { AND: [commentWhere, { OR: pairs }] },
    // Same order as before (most recent to oldest); `id` breaks ties between two notes posted on the same
    // media within the same millisecond, which the old read let the execution plan break.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      mediaObjectId: true,
      content: true,
      timestamp: true,
      createdAt: true,
      guestName: true,
      author: { select: { id: true, name: true } },
      media: {
        select: { id: true, kind: true, originalName: true, thumbnailKey: true, version: versionSelect },
      },
    },
  });
  // A media appears only once: its most recent note, as `distinct` used to do.
  const seen = new Set<number>();
  const out: typeof rows = [];
  for (const row of rows) {
    if (seen.has(row.mediaObjectId)) continue;
    seen.add(row.mediaObjectId);
    out.push(row);
  }
  return out;
}

/** A row of the progress aggregate: one project, one status, one count. */
interface ProjectTaskCount {
  projectId: number;
  status: TaskStatus;
  isDone: boolean | null;
  isInactive: boolean | null;
  legacyStatus: TaskStatus | null;
  count: number;
}

/**
 * Progress of recent projects in ONE query: tasks per project and per status.
 *
 * The statuses are joined here rather than re-read afterwards — the aggregate returns at most a few dozen
 * rows (five projects × the studio vocabulary), whereas the previous pattern issued two correlated `count`
 * per project.
 */
async function taskCountsByProject(
  projectIds: number[],
): Promise<Map<number, { total: number; done: number }>> {
  const out = new Map<number, { total: number; done: number }>();
  if (projectIds.length === 0) return out;
  const rows = await prisma.$queryRaw<ProjectTaskCount[]>`
    SELECT COALESCE(sh."projectId", a."projectId") AS "projectId",
           t.status::text          AS "status",
           ps."isDone"             AS "isDone",
           ps."isInactive"         AS "isInactive",
           ps."legacyStatus"::text AS "legacyStatus",
           COUNT(*)::int           AS "count"
    FROM "Task" t
    LEFT JOIN "Shot" sh  ON sh.id = t."shotId"  AND sh."deletedAt" IS NULL AND sh."hiddenAt" IS NULL
    LEFT JOIN "Asset" a  ON a.id  = t."assetId" AND a."deletedAt" IS NULL AND a."hiddenAt" IS NULL
    LEFT JOIN "PipelineStatus" ps ON ps.id = t."pipelineStatusId"
    WHERE COALESCE(sh."projectId", a."projectId") IN (${Prisma.join(projectIds)})
    GROUP BY 1, 2, 3, 4, 5
  `;
  for (const row of rows) {
    const family = familyOf(row.status, statusRefOf(row));
    // An inactive status (omitted, not applicable) weighs on no progress gauge.
    if (family === 'inactive') continue;
    const entry = out.get(row.projectId) ?? { total: 0, done: 0 };
    entry.total += row.count;
    if (family === 'done') entry.done += row.count;
    out.set(row.projectId, entry);
  }
  return out;
}

export async function getDashboard(user: SessionUser) {
  const access = accessibleProjects(user);
  // The scopes are those of `lib/homeScope`, shared with the pages the cards open: a counter can no longer
  // announce anything other than what its view shows. A CLIENT remains bounded there to the notes meant for
  // them.
  const mediaWhere = publishedMediaInScope(user);
  const commentWhere = commentFeedWhere(user);
  const inReviewWhere = mediaInReviewWhere(user);
  // Trend window: what has been added over the last 7 days.
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [
    lastComments,
    versions,
    media,
    myTasks,
    projectCount,
    mediaInReview,
    commentCount,
    mediaInReview7d,
    commentCount7d,
    myRetakes,
    awaitingMyReview,
    recentProjectRows,
  ] = await Promise.all([
    // Last comment of the six most recently commented media (election in SQL).
    latestCommentPerMedia(commentWhere),
    prisma.version.findMany({
      where: { deletedAt: null, ...versionInProjects(access) },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        author: { select: { id: true, name: true } },
        task: versionSelect.select.task,
        asset: { select: { name: true } },
      },
    }),
    prisma.mediaObject.findMany({
      where: mediaWhere,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        uploader: { select: { id: true, name: true } },
        version: versionSelect,
      },
    }),
    prisma.task.findMany({
      // Same bounds as the retake counter: accessible project, out of the trash, parent not hidden. Without
      // them, the Home page demanded work on a removed shot.
      where: myOpenTasksWhere(user),
      orderBy: { updatedAt: 'desc' },
      take: 24,
      include: {
        shot: { select: { projectId: true, code: true, sequence: { select: { code: true } } } },
        asset: { select: { projectId: true, name: true } },
        pipelineStatus: { select: { isDone: true, isInactive: true, legacyStatus: true } },
      },
    }),
    prisma.project.count({ where: access }),
    // Media actually in review: published, ready, with no decision given.
    prisma.mediaObject.count({ where: inReviewWhere }),
    prisma.comment.count({ where: commentWhere }),
    // 7-day trends — same scopes as the counters they accompany.
    prisma.mediaObject.count({ where: { ...inReviewWhere, createdAt: { gte: weekAgo } } }),
    prisma.comment.count({ where: { ...commentWhere, createdAt: { gte: weekAgo } } }),
    // My retakes/rejections: what requires an immediate action from me.
    prisma.task.count({ where: myRetakesWhere(user) }),
    // What is expected of ME: the reviews entrusted to me that have not yet received a decision (and not, as
    // before, the verdicts expected from the whole studio).
    prisma.mediaObject.count({ where: awaitingMyReviewWhere(user) }),
    // Recent projects (mirror of the sort of GET /api/projects) — progress is computed afterwards.
    prisma.project.findMany({
      where: access,
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, name: true, thumbnailKey: true },
    }),
  ]);

  // Progress + counters per media: two aggregates, no more query per row.
  const [progress, commentCounts] = await Promise.all([
    taskCountsByProject(recentProjectRows.map((p) => p.id)),
    prisma.comment.groupBy({
      by: ['mediaObjectId'],
      // The displayed count follows the same scope as what the reader can open: announcing "12 notes" to a
      // client who will only see 3 would be false.
      where: {
        mediaObjectId: { in: lastComments.map((c) => c.media.id) },
        ...(user.role === Role.CLIENT ? { isVisibleToClient: true } : {}),
      },
      _count: { _all: true },
    }),
  ]);

  // Same image as in the project list: its own, otherwise that of the first published media. The home page
  // stuck to the chosen thumbnail — a project full of delivered work remained nameless there, whereas its
  // card carried an image two screens away.
  const projectFallbacks = await firstMediaThumbKeysForProjects(recentProjectRows.map((p) => p.id));
  const recentProjects = await Promise.all(
    recentProjectRows.map(async (p) => {
      const counts = progress.get(p.id) ?? { total: 0, done: 0 };
      return {
        id: p.id,
        name: p.name,
        thumbnailUrl: await effectiveThumbnailUrl(p.thumbnailKey, projectFallbacks.get(p.id) ?? null),
        totalTasks: counts.total,
        approvedTasks: counts.done,
      };
    }),
  );

  const countByMedia = new Map(commentCounts.map((g) => [g.mediaObjectId, g._count._all]));

  const latestReviews = await Promise.all(
    lastComments.map(async (c) => ({
      mediaId: c.media.id,
      kind: c.media.kind,
      name: c.media.originalName,
      thumbnailUrl: c.media.thumbnailKey ? await storage.getPresignedGetUrl(c.media.thumbnailKey) : null,
      location: loc(c.media.version?.task ?? null) || (c.media.version?.asset?.name ?? ''),
      versionName: c.media.version?.name ?? '',
      commentCount: countByMedia.get(c.media.id) ?? 0,
      lastComment: {
        content: c.content,
        author: c.author?.name ?? c.guestName ?? null,
        timestamp: c.timestamp,
        createdAt: c.createdAt,
      },
    })),
  );

  const activity = [
    ...versions.map((v) => ({
      type: 'version' as const,
      at: v.createdAt,
      label: `${v.name}${v.task ? ' — ' + v.task.name : ''}`,
      location: loc(v.task) || (v.asset?.name ?? ''),
      author: v.author?.name ?? null,
      taskId: v.task?.id ?? null,
      mediaId: null as number | null,
    })),
    ...media.map((m) => ({
      type: 'media' as const,
      at: m.createdAt,
      label: m.originalName,
      location: loc(m.version?.task ?? null) || (m.version?.asset?.name ?? ''),
      author: m.uploader?.name ?? null,
      taskId: m.version?.task?.id ?? null,
      mediaId: m.id,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 15);

  // What requires an action first (mirror of the front end): the status family decides the block, the enum
  // breaks ties within it — RETAKE stays ahead of REJECTED.
  const tasks = myTasks
    .sort((a, b) => taskPriority(a.status, a.pipelineStatus) - taskPriority(b.status, b.pipelineStatus))
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      status: t.status,
      location: loc(t),
      projectId: t.shot?.projectId ?? t.asset?.projectId ?? null,
      dueDate: t.dueDate,
    }));

  return {
    latestReviews,
    activity,
    myTasks: tasks,
    recentProjects,
    stats: {
      projects: projectCount,
      mediaInReview,
      comments: commentCount,
      mediaInReview7d,
      comments7d: commentCount7d,
      myRetakes,
      awaitingMyReview,
    },
  };
}
