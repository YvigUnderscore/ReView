import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { isValidDiscordWebhook } from '../lib/sanitize';
import { badRequest, notFound } from '../lib/errors';

const router = Router();
router.use(authenticate);

// GET /api/studio — infos du studio (singleton)
router.get('/', async (_req, res) => {
  const studio = await prisma.studio.findFirst();
  if (!studio) throw notFound('Studio non configuré');
  res.json({ studio });
});

// PATCH /api/studio — config studio (admin)
router.patch(
  '/',
  requireRole(Role.ADMIN),
  validate({
    body: z.object({
      name: z.string().min(2).max(120).optional(),
      discordWebhookUrl: z.string().url().nullable().optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as { name?: string; discordWebhookUrl?: string | null };
    if (body.discordWebhookUrl && !isValidDiscordWebhook(body.discordWebhookUrl)) {
      throw badRequest('URL de webhook Discord invalide', 'BAD_WEBHOOK');
    }
    const studio = await prisma.studio.findFirst();
    if (!studio) throw notFound('Studio non configuré');
    const updated = await prisma.studio.update({ where: { id: studio.id }, data: body });
    res.json({ studio: updated });
  },
);

// GET /api/studio/settings — réglages clé/valeur (admin)
router.get('/settings', requireRole(Role.ADMIN), async (_req, res) => {
  const settings = await prisma.setting.findMany();
  res.json({ settings: Object.fromEntries(settings.map((s) => [s.key, s.value])) });
});

// PUT /api/studio/settings — upsert d'un réglage (admin) : quotas, limites upload…
router.put(
  '/settings',
  requireRole(Role.ADMIN),
  validate({ body: z.object({ key: z.string().min(1).max(100), value: z.string().max(2000) }) }),
  async (req, res) => {
    const { key, value } = req.body as { key: string; value: string };
    const setting = await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    res.json({ setting });
  },
);

// GET /api/studio/audit — journal d'audit (admin)
router.get('/audit', requireRole(Role.ADMIN), async (_req, res) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ logs });
});

export default router;
