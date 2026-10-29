// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as Inbox from '../services/NotificationInboxService';

const router = Router();
router.use(authenticate);

// GET /api/notifications — the user's notifications, plus the unread count
router.get('/', async (req, res) => {
  res.json(await Inbox.listInbox(requireUser(req).id));
});

// PATCH /api/notifications/:id/read — marks a notification as read
router.patch(
  '/:id/read',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    res.json({ notification: await Inbox.markRead(requireUser(req).id, Number(req.params.id)) });
  },
);

// POST /api/notifications/read-all — marks all as read
router.post('/read-all', async (req, res) => {
  await Inbox.markAllRead(requireUser(req).id);
  res.json({ ok: true });
});

export default router;
