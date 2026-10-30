// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, AnnouncementType, AnnouncementFrequency } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as AnnouncementService from '../services/AnnouncementService';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

const bodySchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  type: z.nativeEnum(AnnouncementType).default(AnnouncementType.INFO),
  frequency: z.nativeEnum(AnnouncementFrequency).default(AnnouncementFrequency.PERMANENT),
  roles: z.array(z.nativeEnum(Role)).default([]),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  active: z.boolean().default(true),
});

// GET /api/announcements/active — announcements to show the user (period, role, frequency)
router.get('/active', async (req, res) => {
  res.json({ announcements: await AnnouncementService.active(requireUser(req)) });
});

// POST /api/announcements/:id/ack — read receipt (hidden according to the frequency)
router.post('/:id/ack', validate({ params: idParam }), async (req, res) => {
  await AnnouncementService.acknowledge(requireUser(req), Number(req.params.id));
  res.status(204).end();
});

// GET /api/announcements — full list (admin)
router.get('/', requireRole(Role.ADMIN), async (_req, res) => {
  res.json({ announcements: await AnnouncementService.list() });
});

// POST /api/announcements — creation (admin)
router.post('/', requireRole(Role.ADMIN), validate({ body: bodySchema }), async (req, res) => {
  res.status(201).json({ announcement: await AnnouncementService.create(requireUser(req), req.body) });
});

// PATCH /api/announcements/:id — edit (admin)
router.patch(
  '/:id',
  requireRole(Role.ADMIN),
  validate({ params: idParam, body: bodySchema }),
  async (req, res) => {
    res.json({
      announcement: await AnnouncementService.update(requireUser(req), Number(req.params.id), req.body),
    });
  },
);

// DELETE /api/announcements/:id — deletion (admin)
router.delete('/:id', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  await AnnouncementService.remove(requireUser(req), Number(req.params.id));
  res.status(204).end();
});

export default router;
