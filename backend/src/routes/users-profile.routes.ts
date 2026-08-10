// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as UserService from '../services/UserService';

/**
 * Fiche d'un membre et avatar — monté sur `/api/users`, avant les routes d'administration
 * pour que `/me/avatar` ne soit pas avalé par `/:id`. Séparé de `users.routes` qui tient
 * déjà tout le cycle de vie des comptes (budget de 200 lignes par routeur).
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

// GET /api/users/:id/profile — fiche publique d'un membre (tout compte authentifié)
router.get('/:id/profile', validate({ params: idParam }), async (req, res) => {
  const profile = await UserService.getProfile(req.user!.id, req.user!.role, Number(req.params.id));
  res.json({ user: profile });
});

// POST /api/users/me/avatar/presign — URL présignée pour l'upload d'avatar
router.post(
  '/me/avatar/presign',
  validate({ body: z.object({ contentType: z.string().regex(/^image\/(png|jpe?g|webp)$/) }) }),
  async (req, res) => {
    res.json(await UserService.presignAvatar(req.user!.id, req.body.contentType));
  },
);

// PUT /api/users/me/avatar — enregistre la clé après upload réussi
router.put(
  '/me/avatar',
  validate({ body: z.object({ key: z.string().max(256).nullable() }) }),
  async (req, res) => {
    res.json({ user: await UserService.setAvatar(req.user!.id, req.body.key) });
  },
);

export default router;
