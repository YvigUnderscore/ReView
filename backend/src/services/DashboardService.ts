// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus, Prisma, Role, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';

/**
 * Données de la page Accueil (12.B) : dernières reviews commentées, flux d'activité,
 * mes tâches assignées et statistiques — le tout borné à « mes projets »
 * (ADMIN/SUPERVISOR voient tout, sinon filtre par membership, motif lib/search.ts).
 */

type SessionUser = { id: number; role: Role };

const isGlobal = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

/** Filtre projet accessible (corbeille exclue). */
const accessWhere = (user: SessionUser): Prisma.ProjectWhereInput =>
  isGlobal(user.role) ? { deletedAt: null } : { deletedAt: null, memberships: { some: { userId: user.id } } };

/** Sélecteur des versions rattachées à un projet accessible (3 chemins de rattachement). */
const versionInAccess = (access: Prisma.ProjectWhereInput): Prisma.VersionWhereInput => ({
  OR: [
    { task: { shot: { deletedAt: null, project: access } } },
    { task: { asset: { deletedAt: null, project: access } } },
    { asset: { deletedAt: null, project: access } },
  ],
});

/** Localisation lisible d'une tâche (SQ010 · SH020 ou nom d'asset). */
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

/** Ordre d'affichage des tâches : ce qui demande une action en premier (miroir du front). */
const TASK_PRIORITY: Record<TaskStatus, number> = {
  RETAKE: 0,
  REJECTED: 1,
  PENDING_REVIEW: 2,
  IN_PROGRESS: 3,
  TODO: 4,
  APPROVED: 5,
};

export async function getDashboard(user: SessionUser) {
  const access = accessWhere(user);
  const mediaWhere: Prisma.MediaObjectWhereInput = {
    deletedAt: null,
    published: true,
    status: MediaStatus.READY,
    version: versionInAccess(access),
  };
  // Fenêtre des tendances : ce qui s'est ajouté sur les 7 derniers jours.
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  // Tâche vivante rattachée à un projet accessible (les deux chemins de rattachement).
  const taskInAccess: Prisma.TaskWhereInput = {
    OR: [
      { shot: { deletedAt: null, project: access } },
      { asset: { deletedAt: null, project: access } },
    ],
  };

  const [
    lastComments,
    versions,
    media,
    myTasks,
    projectCount,
    mediaCount,
    commentCount,
    mediaCount7d,
    commentCount7d,
    myRetakes,
    pendingReview,
    recentProjectRows,
  ] = await Promise.all([
    // Dernier commentaire par média (distinct après tri desc = le plus récent de chacun).
    prisma.comment.findMany({
      where: { media: mediaWhere },
      orderBy: { createdAt: 'desc' },
      distinct: ['mediaObjectId'],
      take: 6,
      include: {
        author: { select: { id: true, name: true } },
        media: {
          select: {
            id: true,
            kind: true,
            originalName: true,
            thumbnailKey: true,
            version: versionSelect,
          },
        },
      },
    }),
    prisma.version.findMany({
      where: { deletedAt: null, ...versionInAccess(access) },
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
      where: {
        assigneeId: user.id,
        status: { not: TaskStatus.APPROVED },
        OR: [
          { shot: { deletedAt: null, project: { deletedAt: null } } },
          { asset: { deletedAt: null, project: { deletedAt: null } } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 24,
      include: {
        shot: { select: { projectId: true, code: true, sequence: { select: { code: true } } } },
        asset: { select: { projectId: true, name: true } },
      },
    }),
    prisma.project.count({ where: access }),
    prisma.mediaObject.count({ where: mediaWhere }),
    prisma.comment.count({ where: { media: mediaWhere } }),
    // Tendances 7 jours — mêmes périmètres que les compteurs globaux.
    prisma.mediaObject.count({ where: { ...mediaWhere, createdAt: { gte: weekAgo } } }),
    prisma.comment.count({ where: { media: mediaWhere, createdAt: { gte: weekAgo } } }),
    // Mes retakes/rejets : ce qui me demande une action immédiate.
    prisma.task.count({
      where: { assigneeId: user.id, status: { in: [TaskStatus.RETAKE, TaskStatus.REJECTED] } },
    }),
    // Verdicts attendus dans mon périmètre (tâches en attente de review).
    prisma.task.count({ where: { status: TaskStatus.PENDING_REVIEW, ...taskInAccess } }),
    // Projets récents (miroir du tri de GET /api/projects) — la progression est calculée après.
    prisma.project.findMany({
      where: access,
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, name: true, thumbnailKey: true },
    }),
  ]);

  // Progression des projets récents : tâches approuvées / total (deux counts par projet).
  const recentProjects = await Promise.all(
    recentProjectRows.map(async (p) => {
      const inProject: Prisma.TaskWhereInput = {
        OR: [{ shot: { deletedAt: null, projectId: p.id } }, { asset: { deletedAt: null, projectId: p.id } }],
      };
      const [totalTasks, approvedTasks] = await Promise.all([
        prisma.task.count({ where: inProject }),
        prisma.task.count({ where: { status: TaskStatus.APPROVED, ...inProject } }),
      ]);
      return {
        id: p.id,
        name: p.name,
        thumbnailUrl: p.thumbnailKey ? await storage.getPresignedGetUrl(p.thumbnailKey) : null,
        totalTasks,
        approvedTasks,
      };
    }),
  );

  // Nombre de commentaires par média affiché en « dernières reviews ».
  const commentCounts = await prisma.comment.groupBy({
    by: ['mediaObjectId'],
    where: { mediaObjectId: { in: lastComments.map((c) => c.media.id) } },
    _count: { _all: true },
  });
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
      mediaId: m.id as number | null,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 15);

  const tasks = myTasks
    .sort((a, b) => TASK_PRIORITY[a.status] - TASK_PRIORITY[b.status])
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
      publishedMedia: mediaCount,
      comments: commentCount,
      publishedMedia7d: mediaCount7d,
      comments7d: commentCount7d,
      myRetakes,
      pendingReview,
    },
  };
}
