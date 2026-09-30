// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import type { Queue } from 'bullmq';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { mediaQueue, storageCleanupQueue, webhookQueue } from '../services/JobService';
import { logAudit } from '../services/AuditService';
import { badRequest, notFound } from '../lib/errors';

/** Dashboard BullMQ (37.C) — monté sous /api/admin/jobs (admin). */
const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

const QUEUES: Record<string, Queue> = {
  media: mediaQueue,
  'storage-cleanup': storageCleanupQueue,
  webhooks: webhookQueue,
};

const queueParam = z.object({ queue: z.enum(['media', 'storage-cleanup', 'webhooks']) });

const jobView = (j: {
  id?: string;
  name: string;
  data: unknown;
  failedReason?: string;
  attemptsMade?: number;
  timestamp?: number;
  processedOn?: number | null;
}) => ({
  id: j.id ?? null,
  name: j.name,
  data: j.data,
  failedReason: j.failedReason ?? null,
  attemptsMade: j.attemptsMade ?? 0,
  createdAt: j.timestamp ? new Date(j.timestamp).toISOString() : null,
});

// GET /api/admin/jobs — compteurs par file + jobs récents (actifs, en attente, échoués)
router.get('/', async (_req, res) => {
  const queues = await Promise.all(
    Object.entries(QUEUES).map(async ([key, q]) => {
      const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      const [failed, active, waiting] = await Promise.all([
        q.getJobs(['failed'], 0, 19, false),
        q.getJobs(['active'], 0, 9, true),
        q.getJobs(['waiting', 'delayed'], 0, 9, true),
      ]);
      return {
        key,
        counts,
        failed: failed.map(jobView),
        active: active.map(jobView),
        waiting: waiting.map(jobView),
      };
    }),
  );
  res.json({ queues });
});

// POST /api/admin/jobs/:queue/:id/retry — relance un job échoué
router.post(
  '/:queue/:id/retry',
  validate({ params: queueParam.extend({ id: z.string().max(100) }) }),
  async (req, res) => {
    const q = QUEUES[String(req.params.queue)]!;
    const job = await q.getJob(String(req.params.id));
    if (!job) throw notFound('Job not found');
    if (!(await job.isFailed())) throw badRequest('Only a failed job can be retried');
    await job.retry();
    logAudit({
      userId: req.user!.id,
      action: 'JOB_RETRY',
      entityType: 'Job',
      metadata: { queue: req.params.queue, id: job.id, name: job.name },
    });
    res.json({ retried: true });
  },
);

// POST /api/admin/jobs/:queue/clean-failed — purge les jobs échoués de la file
router.post('/:queue/clean-failed', validate({ params: queueParam }), async (req, res) => {
  const q = QUEUES[String(req.params.queue)]!;
  const removed = await q.clean(0, 1000, 'failed');
  logAudit({
    userId: req.user!.id,
    action: 'JOBS_CLEAN_FAILED',
    entityType: 'Job',
    metadata: { queue: req.params.queue, removed: removed.length },
  });
  res.json({ removed: removed.length });
});

export default router;
