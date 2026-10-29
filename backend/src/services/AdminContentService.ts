// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma, MediaKind, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { toPublicUser } from '../lib/userView';
import { pageArgs, paginate, orderByFrom, type PaginationParams } from '../lib/pagination';

/**
 * Global content lists for administration: versions (all projects, filtered by
 * project/status/type/publication) and comments (search + moderation). The `where`
 * clause builders and the location label are pure (and tested).
 */

// ── Versions ─────────────────────────────────────────────────────────────────

export interface VersionFilters {
  projectId?: number;
  status?: VersionStatus;
  published?: boolean;
  kind?: MediaKind;
  q?: string;
}

/** "Version -> project" paths (a version lives under a shot/asset task, or directly under an asset). */
export function projectPathsOf(projectId: number): Prisma.VersionWhereInput[] {
  return [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }];
}

/** Prisma clause for a filtered list of versions (admin, all projects). */
export function versionWhere(f: VersionFilters): Prisma.VersionWhereInput {
  const where: Prisma.VersionWhereInput = { deletedAt: null };
  if (f.status) where.status = f.status;
  if (f.published !== undefined) where.published = f.published;
  if (f.kind) where.media = { some: { kind: f.kind, deletedAt: null } };
  if (f.q) where.name = { contains: f.q, mode: 'insensitive' };
  if (f.projectId) where.OR = projectPathsOf(f.projectId);
  return where;
}

/** Minimal shape needed for a version's location label. */
export interface VersionLocationInput {
  task?: {
    name: string;
    shot?: { code: string; sequence?: { code: string } | null } | null;
    asset?: { name: string } | null;
  } | null;
  asset?: { name: string } | null;
}

/** Readable location: "SQ010 · SH020 › anim", "perso › lookdev" or "perso". */
export function versionLocation(v: VersionLocationInput): string {
  const t = v.task;
  if (t?.shot) {
    const seq = t.shot.sequence ? `${t.shot.sequence.code} · ` : '';
    return `${seq}${t.shot.code} › ${t.name}`;
  }
  if (t?.asset) return `${t.asset.name} › ${t.name}`;
  return v.asset?.name ?? '';
}

/** Paginated list of studio versions (admin), with location and media. */
export async function listVersions(f: VersionFilters, p: PaginationParams) {
  const where = versionWhere(f);
  const [rows, total] = await Promise.all([
    prisma.version.findMany({
      where,
      orderBy: orderByFrom(p, ['createdAt', 'updatedAt', 'name'], { createdAt: 'desc' }),
      ...pageArgs(p),
      select: {
        id: true,
        name: true,
        status: true,
        published: true,
        createdAt: true,
        author: { select: { id: true, name: true, username: true, email: true } },
        reviewStatus: { select: { id: true, name: true, color: true } },
        task: {
          select: {
            name: true,
            shot: {
              select: { projectId: true, code: true, sequence: { select: { code: true } } },
            },
            asset: { select: { projectId: true, name: true } },
          },
        },
        asset: { select: { projectId: true, name: true } },
        media: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true, kind: true },
        },
      },
    }),
    prisma.version.count({ where }),
  ]);
  const items = rows.map((v) => ({
    id: v.id,
    name: v.name,
    status: v.status,
    published: v.published,
    createdAt: v.createdAt,
    author: v.author ? { id: v.author.id, name: v.author.username ?? v.author.name ?? v.author.email } : null,
    reviewStatus: v.reviewStatus,
    location: versionLocation(v),
    projectId: v.task?.shot?.projectId ?? v.task?.asset?.projectId ?? v.asset?.projectId ?? null,
    mediaCount: v.media.length,
    kinds: [...new Set(v.media.map((m) => m.kind))],
    firstMediaId: v.media[0]?.id ?? null,
  }));
  return paginate(items, total, p);
}

// ── Commentaires ─────────────────────────────────────────────────────────────

export interface CommentFilters {
  projectId?: number;
  authorId?: number;
  resolved?: boolean;
  q?: string;
}

/** Prisma clause for a filtered list of comments (admin, moderation). */
export function commentWhere(f: CommentFilters): Prisma.CommentWhereInput {
  const where: Prisma.CommentWhereInput = {};
  if (f.authorId) where.userId = f.authorId;
  if (f.resolved !== undefined) where.isResolved = f.resolved;
  if (f.q) where.content = { contains: f.q, mode: 'insensitive' };
  if (f.projectId) where.media = { version: { OR: projectPathsOf(f.projectId) } };
  return where;
}

/** Paginated list of studio comments (admin): search and moderation. */
export async function listComments(f: CommentFilters, p: PaginationParams) {
  const where = commentWhere(f);
  const [rows, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      orderBy: orderByFrom(p, ['createdAt'], { createdAt: 'desc' }),
      ...pageArgs(p),
      select: {
        id: true,
        content: true,
        timestamp: true,
        isResolved: true,
        resolvedAt: true,
        parentId: true,
        createdAt: true,
        guestName: true,
        author: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            username: true,
            avatarKey: true,
          },
        },
        media: { select: { id: true, originalName: true, kind: true } },
        _count: { select: { replies: true } },
      },
    }),
    prisma.comment.count({ where }),
  ]);
  const items = await Promise.all(
    rows.map(async (c) => ({
      id: c.id,
      content: c.content,
      timestamp: c.timestamp,
      isResolved: c.isResolved,
      resolvedAt: c.resolvedAt,
      parentId: c.parentId,
      createdAt: c.createdAt,
      guestName: c.guestName,
      author: c.author ? await toPublicUser(c.author) : null,
      media: c.media,
      replyCount: c._count.replies,
    })),
  );
  return paginate(items, total, p);
}
