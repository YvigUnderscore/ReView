import { Router } from 'express';
import os from 'node:os';
import { statfs } from 'node:fs/promises';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { mediaQueue } from '../services/JobService';
import { storage } from '../services/StorageService';
import { getOnlineUserIds } from '../services/PresenceService';
import { logAudit } from '../services/AuditService';
import { getStudioProjectDefaults, setStudioProjectDefaults } from '../lib/projectSettings';
import { validate } from '../middleware/validate';
import { z } from 'zod';

const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

// GET /api/admin/project-defaults — réglages par défaut des nouveaux projets
router.get('/project-defaults', async (_req, res) => {
  res.json({ settings: await getStudioProjectDefaults() });
});

// PUT /api/admin/project-defaults — départements + nomenclature par défaut (overridables/projet)
router.put(
  '/project-defaults',
  validate({
    body: z.object({
      departments: z
        .array(z.object({ key: z.string().min(1).max(40), name: z.string().min(1).max(80) }))
        .optional(),
      nomenclature: z
        .object({
          sequencePrefix: z.string().max(16),
          shotPrefix: z.string().max(16),
          padding: z.number().int().min(1).max(8),
          step: z.number().int().min(1),
        })
        .optional(),
    }),
  }),
  async (req, res) => {
    const settings = await setStudioProjectDefaults(req.body);
    logAudit({ userId: req.user!.id, action: 'PROJECT_DEFAULTS_UPDATE', entityType: 'Setting' });
    res.json({ settings });
  },
);

// GET /api/admin/dashboard — métriques studio (compat. ascendante, vue compacte)
router.get('/dashboard', async (_req, res) => {
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

  res.json({
    users: { total: userCount, byRole: Object.fromEntries(usersByRole.map((r) => [r.role, r._count._all])) },
    projects: projectCount,
    media: { count: mediaCount, storageBytes: Number(storageAgg._sum.size ?? 0n) },
    recentUploads: recentUploads.map((m) => ({ ...m, size: Number(m.size) })),
  });
});

// GET /api/admin/stats — métriques métier complètes (admin)
router.get('/stats', async (_req, res) => {
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

  res.json({
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
  });
});

// GET /api/admin/system — métriques système + santé des services (admin)
router.get('/system', async (_req, res) => {
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

  // Santé des services
  const [db, redisOk, minio] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    mediaQueue.client
      .then((c) => (c as unknown as { ping: () => Promise<string> }).ping())
      .then(() => true)
      .catch(() => false),
    storage.ping(),
  ]);

  res.json({
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
  });
});

// GET /api/admin/activity?days=30 — séries temporelles (uploads & stockage / jour)
router.get('/activity', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
  const since = new Date(Date.now() - days * 86_400_000);

  // Agrégation par jour (Postgres date_trunc)
  const uploads = await prisma.$queryRaw<{ day: Date; count: bigint; bytes: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count, COALESCE(SUM("size"), 0)::bigint AS bytes
    FROM "MediaObject"
    WHERE "createdAt" >= ${since}
    GROUP BY day ORDER BY day ASC
  `;
  const signups = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
    FROM "User"
    WHERE "createdAt" >= ${since}
    GROUP BY day ORDER BY day ASC
  `;

  res.json({
    days,
    uploads: uploads.map((r) => ({ day: r.day, count: Number(r.count), bytes: Number(r.bytes) })),
    signups: signups.map((r) => ({ day: r.day, count: Number(r.count) })),
  });
});

// GET /api/admin/trash — projets supprimés (corbeille globale, admin)
router.get('/trash', async (_req, res) => {
  const projects = await prisma.project.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    select: { id: true, name: true, slug: true, status: true, deletedAt: true },
  });
  res.json({ projects });
});

// POST /api/admin/jobs/retry — relance tous les jobs média en échec (admin)
router.post('/jobs/retry', async (req, res) => {
  const failed = await mediaQueue.getFailed();
  await Promise.all(failed.map((job) => job.retry().catch(() => undefined)));
  logAudit({
    userId: req.user!.id,
    action: 'JOBS_RETRY',
    entityType: 'Queue',
    metadata: { count: failed.length },
  });
  res.json({ retried: failed.length });
});

export default router;
