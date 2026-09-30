// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as TimelineMarkerService from '../services/TimelineMarkerService';

/**
 * Marqueurs de timeline nommés/colorés partagés (Phase 34.C) — posés par clic droit sur
 * la timeline vidéo. RBAC dans le service (lecture = membre ; écriture = rôles d'écriture ;
 * gestion = auteur ou superviseur).
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

// GET /api/media/:id/markers — marqueurs du média (ordonnés par frame)
router.get('/:id/markers', validate({ params: idParam }), async (req, res) => {
  res.json({ markers: await TimelineMarkerService.list(req.user!, Number(req.params.id)) });
});

// POST /api/media/:id/markers — pose un marqueur nommé/coloré
router.post(
  '/:id/markers',
  validate({ params: idParam, body: z.object({ frame, name, color }) }),
  async (req, res) => {
    const body = req.body as { frame: number; name: string; color: string };
    res
      .status(201)
      .json({ marker: await TimelineMarkerService.create(req.user!, Number(req.params.id), body) });
  },
);

// PATCH /api/media/:id/markers/:markerId — renomme/recolore/déplace
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
        req.user!,
        Number(req.params.id),
        Number(req.params.markerId),
        body,
      ),
    });
  },
);

// DELETE /api/media/:id/markers/:markerId
router.delete('/:id/markers/:markerId', validate({ params: markerParams }), async (req, res) => {
  await TimelineMarkerService.remove(req.user!, Number(req.params.id), Number(req.params.markerId));
  res.status(204).end();
});

export default router;
