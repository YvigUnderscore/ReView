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
    next(badRequest('An API token cannot manage service tokens'));
    return;
  }
  next();
});

// GET /api/admin/service-tokens — tokens de service actifs
router.get('/', async (_req, res) => {
  res.json({ tokens: await ApiTokenService.listService() });
});

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  scopes: z.array(z.string().max(40)).min(1),
  // ADMIN volontairement absent : un robot n'administre pas le studio.
  role: z.enum([Role.SUPERVISOR, Role.ARTIST, Role.CLIENT]).optional(),
  projectId: z.number().int().positive().optional(),
  expiresInDays: z.number().int().positive().max(3650).optional(),
  /**
   * Mot de passe de l'admin émetteur — même exigence que pour un token personnel
   * (`POST /api/auth/tokens`). Un token de service est *plus* dangereux : il ne meurt pas
   * avec la session de son auteur et porte un rôle à lui. Sans cette ré-authentification,
   * l'écran d'admin rouvrirait par la porte de service l'escalade que la vague 1 a fermée
   * côté profil : un jeton d'accès volé suffirait à se forger une identité machine durable.
   */
  currentPassword: z.string().max(128).optional(),
});

// POST /api/admin/service-tokens — émet un token ; le secret n'est renvoyé qu'ICI
router.post('/', validate({ body: createBody }), async (req, res) => {
  const { currentPassword, ...input } = req.body as z.infer<typeof createBody>;
  await ApiTokenService.assertActorPassword(req.user!.id, currentPassword);
  res.status(201).json(await ApiTokenService.createService(req.user!.id, input));
});

// DELETE /api/admin/service-tokens/:id — révocation immédiate
router.delete('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  await ApiTokenService.revokeService(req.user!.id, Number(req.params.id));
  res.status(204).end();
});

export default router;
