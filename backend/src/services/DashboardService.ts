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

  const [lastComments, versions, media, myTasks, projectCount, mediaCount, commentCount] = await Promise.all([
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
  ]);

  const latestReviews = await Promise.all(
    lastComments.map(async (c) => ({
      mediaId: c.media.id,
      kind: c.media.kind,
      name: c.media.originalName,
      thumbnailUrl: c.media.thumbnailKey ? await storage.getPresignedGetUrl(c.media.thumbnailKey) : null,
      location: loc(c.media.version?.task ?? null) || (c.media.version?.asset?.name ?? ''),
      versionName: c.media.version?.name ?? '',
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
    }));

  return {
    latestReviews,
    activity,
    myTasks: tasks,
    stats: { projects: projectCount, publishedMedia: mediaCount, comments: commentCount },
  };
}
