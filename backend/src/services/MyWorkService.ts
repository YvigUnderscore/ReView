// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { paginate, pageArgs, type Paginated, type PaginationParams } from '../lib/pagination';
import {
  commentFeedWhere,
  myOpenTasksWhere,
  myRetakesWhere,
  taskOfProject,
  type SessionUser,
} from '../lib/homeScope';

/**
 * Cross-cutting views of "what awaits me": my tasks and the latest comments of my scope.
 *
 * They exist because the Home page counters led nowhere. Two cards pointed to an anchor (`#my-tasks`) that
 * disappeared along with the "my tasks" block as soon as it was removed from
 * the home page — the click then did nothing — and the comments card opened a page that showed none of them.
 * A figure that cannot be unfolded is not verifiable: one must be able to see its rows.
 *
 * Each list reads the scope of the counter that opens it (`lib/homeScope`), never a copy: this is what
 * guarantees that the page shows as many rows as the card announces.
 */

/** What the list serves a caller who wants to act on their tasks. */
export interface MyTaskRow {
  id: number;
  name: string;
  type: string;
  status: string;
  location: string;
  projectId: number | null;
  projectName: string | null;
  dueDate: Date | null;
}

/** A comment of the thread: what is needed to read it and open it at the right spot of the media. */
export interface CommentFeedRow {
  id: number;
  mediaId: number;
  mediaKind: string;
  mediaName: string;
  location: string;
  versionName: string;
  content: string;
  timestamp: number | null;
  createdAt: Date;
  author: string | null;
}

/** Readable location (SQ010 · SH020, or asset name) — same form as on the Home page. */
function place(
  holder: {
    shot?: { code: string; sequence?: { code: string } | null } | null;
    asset?: { name: string } | null;
  } | null,
): string {
  if (!holder) return '';
  if (holder.shot) {
    return `${holder.shot.sequence ? holder.shot.sequence.code + ' · ' : ''}${holder.shot.code}`;
  }
  return holder.asset?.name ?? '';
}

/**
 * My tasks, across all projects.
 *
 * `scope` says which of the two personal cards was clicked: everything assigned to me and alive, or only what
 * came back to me (retake, rejection). The sort places the nearest deadline first and tasks without a date at
 * the end — an `id` breaks ties, otherwise two tasks without a deadline could change page from one request to
 * the next.
 *
 * `projectId` restricts the same list to one project: this is what the "my tasks" block of the overview
 * shows. The scope remains that of the counter — the filter only narrows it, it never widens it.
 */
export async function listMyTasks(
  user: SessionUser,
  scope: 'all' | 'blocked',
  p: PaginationParams,
  projectId?: number,
): Promise<Paginated<MyTaskRow>> {
  const scoped = scope === 'blocked' ? myRetakesWhere(user) : myOpenTasksWhere(user);
  const where: Prisma.TaskWhereInput = projectId ? { AND: [scoped, taskOfProject(projectId)] } : scoped;
  const parent = { select: { name: true } };
  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }],
      ...pageArgs(p),
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        dueDate: true,
        shot: {
          select: { projectId: true, code: true, sequence: { select: { code: true } }, project: parent },
        },
        asset: { select: { projectId: true, name: true, project: parent } },
      },
    }),
    prisma.task.count({ where }),
  ]);
  const items = rows.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    status: t.status,
    location: place(t),
    projectId: t.shot?.projectId ?? t.asset?.projectId ?? null,
    projectName: t.shot?.project.name ?? t.asset?.project.name ?? null,
    dueDate: t.dueDate,
  }));
  return paginate(items, total, p);
}

/**
 * The latest comments of my scope, from most recent to oldest.
 *
 * The thread returns one comment per row — and not one media per row as "latest reviews" does: it is the
 * figure of the "comments" card that it unfolds. The heavy columns (annotation trace,
 * 3D viewpoint, attachments) remain in the database: nothing that is not displayed crosses the network.
 */
export async function listMyComments(
  user: SessionUser,
  p: PaginationParams,
): Promise<Paginated<CommentFeedRow>> {
  const where = commentFeedWhere(user);
  const [rows, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(p),
      select: {
        id: true,
        content: true,
        timestamp: true,
        createdAt: true,
        guestName: true,
        author: { select: { name: true } },
        media: {
          select: {
            id: true,
            kind: true,
            originalName: true,
            version: {
              select: {
                name: true,
                task: {
                  select: {
                    shot: { select: { code: true, sequence: { select: { code: true } } } },
                    asset: { select: { name: true } },
                  },
                },
                asset: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    prisma.comment.count({ where }),
  ]);
  const items = rows.map((c) => ({
    id: c.id,
    mediaId: c.media.id,
    mediaKind: c.media.kind,
    mediaName: c.media.originalName,
    location: place(c.media.version?.task ?? null) || (c.media.version?.asset?.name ?? ''),
    versionName: c.media.version?.name ?? '',
    content: c.content,
    timestamp: c.timestamp,
    createdAt: c.createdAt,
    author: c.author?.name ?? c.guestName ?? null,
  }));
  return paginate(items, total, p);
}
