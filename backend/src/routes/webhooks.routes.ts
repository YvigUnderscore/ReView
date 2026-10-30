// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { EMITTED_WEBHOOK_EVENTS } from '../lib/webhookCatalog';
import { listDeliveries, queueDelivery, replayDelivery } from '../services/WebhookService';
import * as WebhookAdmin from '../services/WebhookAdminService';
import { logAudit } from '../services/AuditService';
import { badRequest, notFound } from '../lib/errors';

/** Outgoing webhooks (36.D): administration. Mounted under /api/admin/webhooks. */
const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

const idParam = z.object({ id: z.coerce.number().int() });
const deliveryParams = idParam.extend({ deliveryId: z.coerce.number().int() });
// Only events actually published are offered: a subscription that cannot be honoured makes a wired
// alert look real (see lib/webhookCatalog).
const eventsSchema = z.array(z.enum(EMITTED_WEBHOOK_EVENTS)).min(1);
const projectIdSchema = z.number().int().positive().nullable().optional();

const findHook = WebhookAdmin.getHook;

// GET /api/admin/webhooks: list (never the secret)
router.get('/', async (_req, res) => {
  res.json({ webhooks: await WebhookAdmin.listHooks() });
});

// POST /api/admin/webhooks: creates a webhook; the HMAC secret is shown ONLY here
router.post(
  '/',
  validate({
    body: z.object({ url: z.string().url().max(500), events: eventsSchema, projectId: projectIdSchema }),
  }),
  async (req, res) => {
    const body = req.body as { url: string; events: string[]; projectId?: number | null };
    res.status(201).json(await WebhookAdmin.createHook(requireUser(req).id, body));
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
    const body = req.body as WebhookAdmin.WebhookInput;
    res.json({ webhook: await WebhookAdmin.updateHook(requireUser(req).id, Number(req.params.id), body) });
  },
);

// DELETE /api/admin/webhooks/:id
router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  await WebhookAdmin.deleteHook(requireUser(req).id, Number(req.params.id));
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
const deliveriesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  before: z.coerce.number().int().positive().optional(),
});
router.get('/:id/deliveries', validate({ params: idParam, query: deliveriesQuery }), async (req, res) => {
  const existing = await findHook(Number(req.params.id));
  // Re-read through the schema: under Express 5 the coercion done by `validate` does not persist on
  // `req.query`, and `?limit=10` would reach Prisma's `take` as the string "10".
  const { limit, before } = deliveriesQuery.parse(req.query);
  res.json(await listDeliveries(existing.id, limit, before));
});

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
