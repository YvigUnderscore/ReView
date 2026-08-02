// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma, MediaKind, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { toPublicUser } from '../lib/userView';
import { pageArgs, paginate, orderByFrom, type PaginationParams } from '../lib/pagination';

/**
 * Listes globales de contenus pour l'administration : versions (tous projets, filtres
 * projet/statut/type/publication) et commentaires (recherche + modération). Les
 * constructeurs de clauses `where` et le libellé de localisation sont purs (testés).
 */

// ── Versions ─────────────────────────────────────────────────────────────────

export interface VersionFilters {
  projectId?: number;
  status?: VersionStatus;
  published?: boolean;
  kind?: MediaKind;
  q?: string;
}

/** Chemins « version → projet » (une version vit sous une tâche de shot/asset, ou un asset). */
export function projectPathsOf(projectId: number): Prisma.VersionWhereInput[] {
  return [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }];
}

/** Clause Prisma d'une liste de versions filtrée (admin, tous projets). */
export function versionWhere(f: VersionFilters): Prisma.VersionWhereInput {
  const where: Prisma.VersionWhereInput = { deletedAt: null };
  if (f.status) where.status = f.status;
  if (f.published !== undefined) where.published = f.published;
  if (f.kind) where.media = { some: { kind: f.kind, deletedAt: null } };
  if (f.q) where.name = { contains: f.q, mode: 'insensitive' };
  if (f.projectId) where.OR = projectPathsOf(f.projectId);
  return where;
}

/** Forme minimale nécessaire au libellé de localisation d'une version. */
export interface VersionLocationInput {
  task?: {
    name: string;
    shot?: { code: string; sequence?: { code: string } | null } | null;
    asset?: { name: string } | null;
  } | null;
  asset?: { name: string } | null;
}

/** Localisation lisible : « SQ010 · SH020 › anim », « perso › lookdev » ou « perso ». */
export function versionLocation(v: VersionLocationInput): string {
  const t = v.task;
  if (t?.shot) {
    const seq = t.shot.sequence ? `${t.shot.sequence.code} · ` : '';
    return `${seq}${t.shot.code} › ${t.name}`;
  }
  if (t?.asset) return `${t.asset.name} › ${t.name}`;
  return v.asset?.name ?? '';
}

/** Liste paginée des versions du studio (admin) avec localisation et médias. */
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

/** Clause Prisma d'une liste de commentaires filtrée (admin, modération). */
export function commentWhere(f: CommentFilters): Prisma.CommentWhereInput {
  const where: Prisma.CommentWhereInput = {};
  if (f.authorId) where.userId = f.authorId;
  if (f.resolved !== undefined) where.isResolved = f.resolved;
  if (f.q) where.content = { contains: f.q, mode: 'insensitive' };
  if (f.projectId) where.media = { version: { OR: projectPathsOf(f.projectId) } };
  return where;
}

/** Liste paginée des commentaires du studio (admin) — recherche + modération. */
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
