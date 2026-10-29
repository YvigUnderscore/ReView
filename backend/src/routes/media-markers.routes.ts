// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as TimelineMarkerService from '../services/TimelineMarkerService';

/**
 * Shared named and colored timeline markers (Phase 34.C), placed by right-clicking the video timeline.
 * RBAC lives in the service (read = member; write = writing roles; manage = author or supervisor).
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const markerParams = z.object({
  id: z.coerce.number().int().positive(),
  markerId: z.coerce.number().int().positive(),
});
const name = z.string().trim().min(1).max(80);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const frame = z.number().int().min(0).max(10_000_000);

// GET /api/media/:id/markers — markers of the media (ordered by frame)
router.get('/:id/markers', validate({ params: idParam }), async (req, res) => {
  res.json({ markers: await TimelineMarkerService.list(requireUser(req), Number(req.params.id)) });
});

// POST /api/media/:id/markers — places a named, colored marker
router.post(
  '/:id/markers',
  validate({ params: idParam, body: z.object({ frame, name, color }) }),
  async (req, res) => {
    const body = req.body as { frame: number; name: string; color: string };
    res
      .status(201)
      .json({ marker: await TimelineMarkerService.create(requireUser(req), Number(req.params.id), body) });
  },
);

// PATCH /api/media/:id/markers/:markerId — renames, recolors, moves
router.patch(
  '/:id/markers/:markerId',
  validate({
    params: markerParams,
    body: z
      .object({ frame: frame.optional(), name: name.optional(), color: color.optional() })
      .refine((b) => Object.keys(b).length > 0, { message: 'Aucun champ à modifier' }),
  }),
  async (req, res) => {
    const body = req.body as { frame?: number; name?: string; color?: string };
    res.json({
      marker: await TimelineMarkerService.update(
        requireUser(req),
        Number(req.params.id),
        Number(req.params.markerId),
        body,
      ),
    });
  },
);

// DELETE /api/media/:id/markers/:markerId
router.delete('/:id/markers/:markerId', validate({ params: markerParams }), async (req, res) => {
  await TimelineMarkerService.remove(requireUser(req), Number(req.params.id), Number(req.params.markerId));
  res.status(204).end();
});

export default router;
