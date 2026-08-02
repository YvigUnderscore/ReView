// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { notFound } from '../lib/errors';
import { resolveContext, type ContextEntity } from '../lib/context';

const router = Router();
router.use(authenticate);

const ENTITIES = ['media', 'version', 'task', 'shot', 'sequence', 'asset', 'project'] as const;

// GET /api/context/:entity/:id — chaîne d'ancêtres pour le fil d'Ariane
router.get(
  '/:entity/:id',
  validate({ params: z.object({ entity: z.enum(ENTITIES), id: z.coerce.number().int().positive() }) }),
  async (req, res) => {
    const entity = req.params.entity as ContextEntity;
    const id = Number(req.params.id);
    const context = await resolveContext(entity, id);
    if (!context) throw notFound('Entité introuvable');
    await assertProjectAccess(req, context.project.id);
    res.json({ context });
  },
);

export default router;
