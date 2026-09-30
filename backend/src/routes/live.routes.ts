// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { listLiveSessions } from '../services/LiveSessionService';

const router = Router();
router.use(authenticate);

// GET /api/live/sessions?projectId= — sessions live en cours du projet (badges LIVE :
// bouton de la review, cartes de version). Rafraîchi côté client sur l'event socket
// `live:changed` diffusé à la room du projet.
router.get(
  '/sessions',
  validate({ query: z.object({ projectId: z.coerce.number().int().positive() }) }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    res.json({ sessions: listLiveSessions(projectId) });
  },
);

export default router;
