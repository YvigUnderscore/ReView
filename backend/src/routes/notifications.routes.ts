// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { notFound } from '../lib/errors';

const router = Router();
router.use(authenticate);

// GET /api/notifications — notifications de l'utilisateur + nombre non lues
router.get('/', async (req, res) => {
  const userId = req.user!.id;
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  res.json({ notifications, unread });
});

// PATCH /api/notifications/:id/read — marque une notification comme lue
router.patch(
  '/:id/read',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const notif = await prisma.notification.findFirst({ where: { id, userId: req.user!.id } });
    if (!notif) throw notFound('Notification not found');
    const updated = await prisma.notification.update({ where: { id }, data: { isRead: true } });
    res.json({ notification: updated });
  },
);

// POST /api/notifications/read-all — marque toutes comme lues
router.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, isRead: false },
    data: { isRead: true },
  });
  res.json({ ok: true });
});

export default router;
