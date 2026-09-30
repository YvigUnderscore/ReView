// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import os from 'node:os';
import { statfs } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { mediaQueue } from './JobService';
import { storage } from './StorageService';
import { getOnlineUserIds } from './PresenceService';
import { logAudit } from './AuditService';

/**
 * Logique métier de l'administration (métriques studio, santé système, séries
 * temporelles, corbeille globale, maintenance des jobs). Réservé aux admins ;
 * l'assertion de rôle est faite au niveau de la route (10.D8).
 */

/** Métriques compactes (compat. ascendante). */
export async function dashboard() {
  const [userCount, usersByRole, projectCount, mediaCount, storageAgg, recentUploads] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    prisma.project.count({ where: { deletedAt: null } }),
    prisma.mediaObject.count(),
    prisma.mediaObject.aggregate({ _sum: { size: true } }),
    prisma.mediaObject.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        originalName: true,
        kind: true,
        status: true,
        size: true,
        createdAt: true,
        uploader: { select: { id: true, name: true } },
      },
    }),
  ]);
  return {
    users: { total: userCount, byRole: Object.fromEntries(usersByRole.map((r) => [r.role, r._count._all])) },
    projects: projectCount,
    media: { count: mediaCount, storageBytes: Number(storageAgg._sum.size ?? 0n) },
    recentUploads: recentUploads.map((m) => ({ ...m, size: Number(m.size) })),
  };
}

/** Métriques métier complètes. */
export async function stats() {
  const [
    userCount,
    usersByRole,
    projectCount,
    sequenceCount,
    shotCount,
    assetCount,
    versionCount,
    mediaCount,
    mediaByKind,
    mediaByStatus,
    commentCount,
    storageAgg,
    topStorageUsers,
    jobCounts,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    prisma.project.count({ where: { deletedAt: null } }),
    prisma.sequence.count({ where: { deletedAt: null } }),
    prisma.shot.count({ where: { deletedAt: null } }),
    prisma.asset.count({ where: { deletedAt: null } }),
    prisma.version.count({ where: { deletedAt: null } }),
    prisma.mediaObject.count(),
    prisma.mediaObject.groupBy({ by: ['kind'], _count: { _all: true } }),
    prisma.mediaObject.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.comment.count(),
    prisma.mediaObject.aggregate({ _sum: { size: true } }),
    prisma.user.findMany({
      orderBy: { storageUsed: 'desc' },
      take: 5,
      select: { id: true, name: true, username: true, email: true, storageUsed: true, storageLimit: true },
    }),
    mediaQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed').catch(() => null),
  ]);
  return {
    users: {
      total: userCount,
      byRole: Object.fromEntries(usersByRole.map((r) => [r.role, r._count._all])),
      online: getOnlineUserIds().length,
    },
    pipeline: {
      projects: projectCount,
      sequences: sequenceCount,
      shots: shotCount,
      assets: assetCount,
      versions: versionCount,
    },
    media: {
      count: mediaCount,
      byKind: Object.fromEntries(mediaByKind.map((m) => [m.kind, m._count._all])),
      byStatus: Object.fromEntries(mediaByStatus.map((m) => [m.status, m._count._all])),
      storageBytes: Number(storageAgg._sum.size ?? 0n),
    },
    comments: commentCount,
    jobs: jobCounts,
    topStorageUsers: topStorageUsers.map((u) => ({
      id: u.id,
      name: u.username ?? u.name ?? u.email,
      storageUsed: Number(u.storageUsed),
      storageLimit: u.storageLimit ? Number(u.storageLimit) : null,
    })),
  };
}

/** Métriques système + santé des services (DB, Redis, MinIO). */
export async function system() {
  const totalmem = os.totalmem();
  const freemem = os.freemem();
  const load = os.loadavg(); // [1, 5, 15] min — toujours [0,0,0] sous Windows

  let disk: { total: number; free: number } | null = null;
  try {
    const s = await statfs(process.cwd());
    disk = { total: s.blocks * s.bsize, free: s.bfree * s.bsize };
  } catch {
    /* statfs indisponible (selon OS) */
  }

  const [db, redisOk, minio] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    mediaQueue.client
      .then((c) => (c as unknown as { ping: () => Promise<string> }).ping())
      .then(() => true)
      .catch(() => false),
    storage.ping(),
  ]);

  return {
    host: {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpus: os.cpus().length,
      loadAvg: load,
      uptimeSec: os.uptime(),
      processUptimeSec: Math.round(process.uptime()),
    },
    memory: {
      total: totalmem,
      free: freemem,
      used: totalmem - freemem,
      processRss: process.memoryUsage().rss,
    },
    disk,
    services: { database: db, redis: redisOk, minio },
  };
}

/**
 * Journal d'accès aux médias (36.E), paginé, récent d'abord.
 *
 * Le libellé du lien de partage est rapporté après coup : il n'y a pas de FK vers
 * `ShareLink`, un lien purgé laisserait sinon la ligne d'accès sans nom.
 */
export async function mediaAccessLog({ page, pageSize }: { page: number; pageSize: number }) {
  const [rows, total] = await Promise.all([
    prisma.mediaAccessLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        ip: true,
        shareLinkId: true,
        media: { select: { id: true, originalName: true, kind: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.mediaAccessLog.count(),
  ]);
  const shareIds = [...new Set(rows.map((r) => r.shareLinkId).filter((v): v is number => v != null))];
  const links = shareIds.length
    ? await prisma.shareLink.findMany({ where: { id: { in: shareIds } }, select: { id: true, label: true } })
    : [];
  const labelOf = new Map(links.map((l) => [l.id, l.label]));
  return {
    items: rows.map((r) => ({
      ...r,
      shareLabel: r.shareLinkId != null ? (labelOf.get(r.shareLinkId) ?? 'Lien supprimé') : null,
    })),
    total,
    page,
    pageSize,
  };
}

/** Projets en corbeille (globale). */
export async function trashProjects() {
  return prisma.project.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    select: { id: true, name: true, slug: true, status: true, deletedAt: true },
  });
}

/** Relance tous les jobs média en échec. */
export async function retryFailedJobs(actorId: number) {
  const failed = await mediaQueue.getFailed();
  await Promise.all(failed.map((job) => job.retry().catch(() => undefined)));
  logAudit({
    userId: actorId,
    action: 'JOBS_RETRY',
    entityType: 'Queue',
    metadata: { count: failed.length },
  });
  return failed.length;
}
