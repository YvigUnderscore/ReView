// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { encryptSecret } from '../lib/crypto';
import { isWebhookUrlAllowed, WEBHOOK_EVENTS } from '../lib/webhooks';
import { enqueueWebhookDelivery } from '../services/JobService';
import { logAudit } from '../services/AuditService';
import { badRequest, notFound } from '../lib/errors';

/** Webhooks sortants (36.D) — administration. Monté sous /api/admin/webhooks. */
const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

const hookSelect = {
  id: true,
  url: true,
  events: true,
  active: true,
  lastStatus: true,
  lastError: true,
  lastDeliveryAt: true,
  createdAt: true,
} as const;

const idParam = z.object({ id: z.coerce.number().int() });
const eventsSchema = z.array(z.enum(WEBHOOK_EVENTS)).min(1);

// GET /api/admin/webhooks — liste (jamais le secret)
router.get('/', async (_req, res) => {
  res.json({
    webhooks: await prisma.webhook.findMany({ orderBy: { createdAt: 'desc' }, select: hookSelect }),
  });
});

// POST /api/admin/webhooks — crée un webhook ; le secret HMAC n'est montré qu'ICI
router.post(
  '/',
  validate({ body: z.object({ url: z.string().url().max(500), events: eventsSchema }) }),
  async (req, res) => {
    const { url, events } = req.body as { url: string; events: string[] };
    if (!isWebhookUrlAllowed(url)) {
      throw badRequest('URL de webhook refusée (hôte privé/local ou schéma non http)', 'BAD_WEBHOOK_URL');
    }
    const secret = randomBytes(24).toString('hex');
    const webhook = await prisma.webhook.create({
      data: { url, events, secret: encryptSecret(secret) },
      select: hookSelect,
    });
    logAudit({
      userId: req.user!.id,
      action: 'WEBHOOK_CREATE',
      entityType: 'Webhook',
      entityId: webhook.id,
      metadata: { url, events },
    });
    res.status(201).json({ webhook, secret });
  },
);

// PATCH /api/admin/webhooks/:id — URL / événements / actif
router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z.object({
      url: z.string().url().max(500).optional(),
      events: eventsSchema.optional(),
      active: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as { url?: string; events?: string[]; active?: boolean };
    if (body.url && !isWebhookUrlAllowed(body.url)) {
      throw badRequest('URL de webhook refusée (hôte privé/local ou schéma non http)', 'BAD_WEBHOOK_URL');
    }
    const existing = await prisma.webhook.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound('Webhook introuvable');
    const webhook = await prisma.webhook.update({
      where: { id: existing.id },
      data: body,
      select: hookSelect,
    });
    logAudit({
      userId: req.user!.id,
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
  const existing = await prisma.webhook.findUnique({ where: { id: Number(req.params.id) } });
  if (!existing) throw notFound('Webhook introuvable');
  await prisma.webhook.delete({ where: { id: existing.id } });
  logAudit({
    userId: req.user!.id,
    action: 'WEBHOOK_DELETE',
    entityType: 'Webhook',
    entityId: existing.id,
    metadata: { url: existing.url },
  });
  res.status(204).end();
});

// POST /api/admin/webhooks/:id/test — livraison d'essai (via la file, signée normalement)
router.post('/:id/test', validate({ params: idParam }), async (req, res) => {
  const existing = await prisma.webhook.findUnique({ where: { id: Number(req.params.id) } });
  if (!existing) throw notFound('Webhook introuvable');
  await enqueueWebhookDelivery({
    webhookId: existing.id,
    event: 'test',
    payload: { message: 'Livraison de test ReView', requestedBy: req.user!.id },
  });
  res.status(202).json({ queued: true });
});

export default router;
