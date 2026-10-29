// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, SharePermission, ShareScope } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as ShareLinkService from '../services/ShareLinkService';
import { sendShareMail, SHARE_MAIL_MAX_RECIPIENTS } from '../services/ShareMailService';

/**
 * Studio side of client sharing (35.C): hardened links (scope, password, expiry, view limit), and sending
 * of the link by email. The logic lives in `ShareLinkService` and `ShareMailService`; these routes
 * validate and respond.
 */
const router = Router();
router.use(authenticate);

const manager = requireRole(Role.ADMIN, Role.SUPERVISOR);
const projectQuery = z.object({ projectId: z.coerce.number().int() });
const idParam = z.object({ id: z.coerce.number().int() });

/**
 * Scope of the link. The target is not constrained here but in the service: it must belong to the
 * project, and knowing that requires the database.
 */
const scopeBody = {
  scope: z.nativeEnum(ShareScope).default(ShareScope.PROJECT),
  playlistId: z.number().int().positive().optional(),
  versionId: z.number().int().positive().optional(),
  mediaIds: z.array(z.number().int().positive()).max(ShareLinkService.SHARE_SELECTION_LIMIT).optional(),
};

// GET /api/share?projectId=X — lists a project's share links (supervisor and admin)
router.get('/', manager, validate({ query: projectQuery }), async (req, res) => {
  const projectId = Number(req.query.projectId);
  await assertProjectAccess(req, projectId);
  res.json({ links: await ShareLinkService.list(projectId) });
});

// GET /api/share/candidates?projectId=X — published media, to choose a "selection" scope.
// Declared before `/:id` so that "candidates" is not read as an identifier.
router.get('/candidates', manager, validate({ query: projectQuery }), async (req, res) => {
  const projectId = Number(req.query.projectId);
  await assertProjectAccess(req, projectId);
  res.json({ candidates: await ShareLinkService.candidates(projectId) });
});

// POST /api/share — creates a hardened link (35.C)
router.post(
  '/',
  manager,
  validate({
    body: z.object({
      projectId: z.number().int(),
      permission: z.nativeEnum(SharePermission).default(SharePermission.VIEW),
      label: z.string().trim().min(1).max(120).optional(),
      password: z.string().min(4).max(200).optional(),
      maxViews: z.number().int().positive().max(1_000_000).optional(),
      expiresInDays: z.number().int().positive().max(3650).optional(),
      ...scopeBody,
    }),
  }),
  async (req, res) => {
    const body = req.body as ShareLinkService.CreateShareInput;
    await assertProjectAccess(req, body.projectId);
    res.status(201).json({ link: await ShareLinkService.create(requireUser(req).id, body) });
  },
);

// POST /api/share/:id/email — sends the link, its expiry and its scope to the recipient
router.post(
  '/:id/email',
  manager,
  validate({
    params: idParam,
    body: z.object({
      recipients: z.array(z.string().email()).min(1).max(SHARE_MAIL_MAX_RECIPIENTS),
      note: z.string().trim().max(1000).optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    await assertProjectAccess(req, await ShareLinkService.projectOf(id));
    const body = req.body as { recipients: string[]; note?: string };
    res.json(await sendShareMail(requireUser(req).id, id, body.recipients, body.note ?? null));
  },
);

// DELETE /api/share/:id — revokes a link (supervisor and admin)
router.delete('/:id', manager, validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await ShareLinkService.projectOf(id);
  await assertProjectAccess(req, projectId);
  await ShareLinkService.revoke(requireUser(req).id, id, projectId);
  res.status(204).end();
});

export default router;
