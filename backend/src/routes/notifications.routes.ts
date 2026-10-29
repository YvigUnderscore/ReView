// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, requireUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { notFound } from '../lib/errors';

const router = Router();
router.use(authenticate);

// GET /api/notifications — the user's notifications, plus the unread count
router.get('/', async (req, res) => {
  const userId = requireUser(req).id;
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  res.json({ notifications, unread });
});

// PATCH /api/notifications/:id/read — marks a notification as read
router.patch(
  '/:id/read',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const notif = await prisma.notification.findFirst({ where: { id, userId: requireUser(req).id } });
    if (!notif) throw notFound('Notification not found');
    const updated = await prisma.notification.update({ where: { id }, data: { isRead: true } });
    res.json({ notification: updated });
  },
);

// POST /api/notifications/read-all — marks all as read
router.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: requireUser(req).id, isRead: false },
    data: { isRead: true },
  });
  res.json({ ok: true });
});

export default router;
