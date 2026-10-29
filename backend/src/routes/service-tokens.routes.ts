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
 * Service tokens (API v1): machine identities for a render farm, a pipeline daemon or a bot. Reserved to
 * admins: a service token can write with no human in front of it, so we do not let just anyone issue one.
 * Mounted under /api/admin/service-tokens.
 */
const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

// An API token never mints an identity: otherwise a leaked token would multiply itself.
router.use((req, _res, next) => {
  if (req.apiToken) {
    next(badRequest('An API token cannot manage service tokens'));
    return;
  }
  next();
});

// GET /api/admin/service-tokens — active service tokens
router.get('/', async (_req, res) => {
  res.json({ tokens: await ApiTokenService.listService() });
});

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  scopes: z.array(z.string().max(40)).min(1),
  // ADMIN deliberately absent: a bot does not run the studio.
  role: z.enum([Role.SUPERVISOR, Role.ARTIST, Role.CLIENT]).optional(),
  projectId: z.number().int().positive().optional(),
  expiresInDays: z.number().int().positive().max(3650).optional(),
  /**
   * The issuing admin's password: same requirement as for a personal token (`POST /api/auth/tokens`). A
   * service token is *more* dangerous: it does not die with its author's session and carries a role of
   * its own. Without this re-authentication, the admin screen would reopen through the service door the
   * escalation that wave 1 closed on the profile side: a stolen access token would suffice to forge a
   * durable machine identity.
   */
  currentPassword: z.string().max(128).optional(),
});

// POST /api/admin/service-tokens — issues a token; the secret is returned ONLY HERE
router.post('/', validate({ body: createBody }), async (req, res) => {
  const { currentPassword, ...input } = req.body as z.infer<typeof createBody>;
  await ApiTokenService.assertActorPassword(req.user!.id, currentPassword);
  res.status(201).json(await ApiTokenService.createService(req.user!.id, input));
});

// DELETE /api/admin/service-tokens/:id — immediate revocation
router.delete('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  await ApiTokenService.revokeService(req.user!.id, Number(req.params.id));
  res.status(204).end();
});

export default router;
