// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, SharePermission, ShareScope } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as ShareLinkService from '../services/ShareLinkService';
import { sendShareMail, SHARE_MAIL_MAX_RECIPIENTS } from '../services/ShareMailService';

/**
 * Côté studio du partage client (35.C) : liens durcis — portée, mot de passe, expiration,
 * limite de vues — et envoi du lien par courriel. La logique vit dans `ShareLinkService`
 * et `ShareMailService` ; ces routes valident et répondent.
 */
const router = Router();
router.use(authenticate);

const manager = requireRole(Role.ADMIN, Role.SUPERVISOR);
const projectQuery = z.object({ projectId: z.coerce.number().int() });
const idParam = z.object({ id: z.coerce.number().int() });

/**
 * Portée du lien. La cible n'est pas contrainte ici mais dans le service : elle doit
 * appartenir au projet, et le savoir demande la base.
 */
const scopeBody = {
  scope: z.nativeEnum(ShareScope).default(ShareScope.PROJECT),
  playlistId: z.number().int().positive().optional(),
  versionId: z.number().int().positive().optional(),
  mediaIds: z.array(z.number().int().positive()).max(ShareLinkService.SHARE_SELECTION_LIMIT).optional(),
};

// GET /api/share?projectId=X — liste les liens de partage d'un projet (superviseur/admin)
router.get('/', manager, validate({ query: projectQuery }), async (req, res) => {
  const projectId = Number(req.query.projectId);
  await assertProjectAccess(req, projectId);
  res.json({ links: await ShareLinkService.list(projectId) });
});

// GET /api/share/candidates?projectId=X — médias publiés, pour choisir une portée « sélection ».
// Déclarée avant `/:id` pour que « candidates » ne soit pas lu comme un identifiant.
router.get('/candidates', manager, validate({ query: projectQuery }), async (req, res) => {
  const projectId = Number(req.query.projectId);
  await assertProjectAccess(req, projectId);
  res.json({ candidates: await ShareLinkService.candidates(projectId) });
});

// POST /api/share — crée un lien durci (35.C)
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
    res.status(201).json({ link: await ShareLinkService.create(req.user!.id, body) });
  },
);

// POST /api/share/:id/email — envoie le lien, son expiration et sa portée au destinataire
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
    res.json(await sendShareMail(req.user!.id, id, body.recipients, body.note ?? null));
  },
);

// DELETE /api/share/:id — révoque un lien (superviseur/admin)
router.delete('/:id', manager, validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await ShareLinkService.projectOf(id);
  await assertProjectAccess(req, projectId);
  await ShareLinkService.revoke(req.user!.id, id, projectId);
  res.status(204).end();
});

export default router;
