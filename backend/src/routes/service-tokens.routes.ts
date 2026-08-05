// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { badRequest } from '../lib/errors';
import * as ApiTokenService from '../services/ApiTokenService';

/**
 * Tokens de service (API v1) : identités machine pour une ferme de rendu, un daemon de
 * pipeline ou un bot. Réservés aux admins — un token de service peut écrire sans qu'un
 * humain soit devant, on ne laisse donc pas n'importe qui en émettre.
 * Monté sous /api/admin/service-tokens.
 */
const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

// Un token d'API ne fabrique jamais d'identité : sinon un token fuité se démultiplie.
router.use((req, _res, next) => {
  if (req.apiToken) {
    next(badRequest("Un token d'API ne peut pas gérer les tokens de service"));
    return;
  }
  next();
});

// GET /api/admin/service-tokens — tokens de service actifs
router.get('/', async (_req, res) => {
  res.json({ tokens: await ApiTokenService.listService() });
});

// POST /api/admin/service-tokens — émet un token ; le secret n'est renvoyé qu'ICI
router.post(
  '/',
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(300).optional(),
      scopes: z.array(z.string().max(40)).min(1),
      // ADMIN volontairement absent : un robot n'administre pas le studio.
      role: z.enum([Role.SUPERVISOR, Role.ARTIST, Role.CLIENT]).optional(),
      projectId: z.number().int().positive().optional(),
      expiresInDays: z.number().int().positive().max(3650).optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as ApiTokenService.CreateServiceTokenInput;
    res.status(201).json(await ApiTokenService.createService(req.user!.id, body));
  },
);

// DELETE /api/admin/service-tokens/:id — révocation immédiate
router.delete('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  await ApiTokenService.revokeService(req.user!.id, Number(req.params.id));
  res.status(204).end();
});

export default router;
