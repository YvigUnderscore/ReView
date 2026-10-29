// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate, requireUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { encryptSecret } from '../lib/crypto';
import { isWebhookUrlAllowed } from '../lib/webhooks';
import { EMITTED_WEBHOOK_EVENTS } from '../lib/webhookCatalog';
import { listDeliveries, queueDelivery, replayDelivery } from '../services/WebhookService';
import { logAudit } from '../services/AuditService';
import { badRequest, notFound } from '../lib/errors';

/** Outgoing webhooks (36.D): administration. Mounted under /api/admin/webhooks. */
const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

const hookSelect = {
  id: true,
  url: true,
  events: true,
  active: true,
  projectId: true,
  lastStatus: true,
  lastError: true,
  lastDeliveryAt: true,
  failureStreak: true,
  createdAt: true,
} as const;

const idParam = z.object({ id: z.coerce.number().int() });
const deliveryParams = idParam.extend({ deliveryId: z.coerce.number().int() });
// Only events actually published are offered: a subscription that cannot be honoured makes a wired
// alert look real (see lib/webhookCatalog).
const eventsSchema = z.array(z.enum(EMITTED_WEBHOOK_EVENTS)).min(1);
const projectIdSchema = z.number().int().positive().nullable().optional();

/** The URL is refused if it targets the internal network; the project, if it does not exist. */
async function assertScope(url: string | undefined, projectId: number | null | undefined) {
  if (url && !isWebhookUrlAllowed(url))
    throw badRequest('Webhook URL refused (private or local host, or a non-HTTP scheme)', 'BAD_WEBHOOK_URL');
  if (projectId != null && !(await prisma.project.findUnique({ where: { id: projectId } })))
    throw notFound('Project not found');
}

const findHook = async (id: number) => {
  // Never the secret: it is shown only once, at creation.
  const hook = await prisma.webhook.findUnique({ where: { id }, select: hookSelect });
  if (!hook) throw notFound('Webhook not found');
  return hook;
};

// GET /api/admin/webhooks: list (never the secret)
router.get('/', async (_req, res) => {
  res.json({
    webhooks: await prisma.webhook.findMany({ orderBy: { createdAt: 'desc' }, select: hookSelect }),
  });
});

// POST /api/admin/webhooks: creates a webhook; the HMAC secret is shown ONLY here
router.post(
  '/',
  validate({
    body: z.object({ url: z.string().url().max(500), events: eventsSchema, projectId: projectIdSchema }),
  }),
  async (req, res) => {
    const { url, events, projectId } = req.body as {
      url: string;
      events: string[];
      projectId?: number | null;
    };
    await assertScope(url, projectId);
    const secret = randomBytes(24).toString('hex');
    const webhook = await prisma.webhook.create({
      data: { url, events, projectId: projectId ?? null, secret: encryptSecret(secret) },
      select: hookSelect,
    });
    logAudit({
      userId: requireUser(req).id,
      action: 'WEBHOOK_CREATE',
      entityType: 'Webhook',
      entityId: webhook.id,
      metadata: { url, events, projectId: projectId ?? null },
    });
    res.status(201).json({ webhook, secret });
  },
);

// PATCH /api/admin/webhooks/:id: URL / events / scope / active
router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z.object({
      url: z.string().url().max(500).optional(),
      events: eventsSchema.optional(),
      projectId: projectIdSchema,
      active: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as {
      url?: string;
      events?: string[];
      projectId?: number | null;
      active?: boolean;
    };
    await assertScope(body.url, body.projectId);
    const existing = await findHook(Number(req.params.id));
    const webhook = await prisma.webhook.update({
      where: { id: existing.id },
      // Re-enabling means starting from scratch: otherwise a webhook disabled after five failures
      // would be disabled again at the next failure.
      data: { ...body, ...(body.active === true ? { failureStreak: 0 } : {}) },
      select: hookSelect,
    });
    logAudit({
      userId: requireUser(req).id,
      action: 'WEBHOOK_UPDATE',
      entityType: 'Webhook',
      entityId: existing.id,
      metadata: body,
    });
    res.json({ webhook });
  },
);

// DELETE /api/admin/webhooks/:id
router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const existing = await findHook(Number(req.params.id));
  await prisma.webhook.delete({ where: { id: existing.id } });
  logAudit({
    userId: requireUser(req).id,
    action: 'WEBHOOK_DELETE',
    entityType: 'Webhook',
    entityId: existing.id,
    metadata: { url: existing.url },
  });
  res.status(204).end();
});

// POST /api/admin/webhooks/:id/test: test delivery (via the queue, signed normally)
router.post('/:id/test', validate({ params: idParam }), async (req, res) => {
  const existing = await findHook(Number(req.params.id));
  const deliveryId = await queueDelivery(existing.id, 'test', {
    message: 'ReView test delivery',
    requestedBy: requireUser(req).id,
  });
  res.status(202).json({ queued: true, deliveryId });
});

// GET /api/admin/webhooks/:id/deliveries: delivery log, most recent first
router.get(
  '/:id/deliveries',
  validate({
    params: idParam,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      before: z.coerce.number().int().positive().optional(),
    }),
  }),
  async (req, res) => {
    const existing = await findHook(Number(req.params.id));
    const { limit, before } = req.query as unknown as { limit: number; before?: number };
    res.json(await listDeliveries(existing.id, limit, before));
  },
);

// POST /api/admin/webhooks/:id/deliveries/:deliveryId/replay: replays a lost delivery
router.post('/:id/deliveries/:deliveryId/replay', validate({ params: deliveryParams }), async (req, res) => {
  const existing = await findHook(Number(req.params.id));
  // Replaying towards a disabled webhook would produce nothing: `deliver` stops dead and the new row
  // would stay pending forever. Better to say so.
  if (!existing.active)
    throw badRequest('Enable the webhook before replaying a delivery', 'WEBHOOK_INACTIVE');
  const deliveryId = await replayDelivery(existing.id, Number(req.params.deliveryId));
  if (deliveryId === null) throw notFound('Delivery not found');
  logAudit({
    userId: requireUser(req).id,
    action: 'WEBHOOK_REPLAY',
    entityType: 'Webhook',
    entityId: existing.id,
    metadata: { replayOf: Number(req.params.deliveryId), deliveryId },
  });
  res.status(202).json({ queued: true, deliveryId });
});

export default router;
