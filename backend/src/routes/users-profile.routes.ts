// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { badRequest } from '../lib/errors';
import * as UserService from '../services/UserService';

/**
 * Fiche d'un membre et avatar — monté sur `/api/users`, avant les routes d'administration
 * pour que `/me/avatar` ne soit pas avalé par `/:id`. Séparé de `users.routes` qui tient
 * déjà tout le cycle de vie des comptes (budget de 200 lignes par routeur).
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/**
 * Seule forme de clé d'avatar acceptée : celle que `presignAvatar` vient de produire,
 * `avatars/<id>.<ext>`. Le motif est **ancré** et l'identifiant comparé entier.
 *
 * Un préfixe ouvert (`key.startsWith('avatars/' + id)`) ne ferme pas la comparaison : en
 * décimal, `9` est préfixe de `91`, donc le compte 9 désignait l'avatar du compte 91. Les
 * deux contrôles jumeaux du code (vignette d'entité, image de département) ferment, eux,
 * sur le point séparateur — c'est cette version-là qui fait foi.
 */
const AVATAR_KEY_RE = /^avatars\/(\d+)\.(?:png|jpe?g|webp)$/;
const ownsAvatarKey = (key: string, userId: number): boolean =>
  AVATAR_KEY_RE.exec(key)?.[1] === String(userId);

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
    const key = req.body.key as string | null;
    if (key !== null && !ownsAvatarKey(key, req.user!.id)) throw badRequest('Invalid avatar key', 'BAD_KEY');
    res.json({ user: await UserService.setAvatar(req.user!.id, key) });
  },
);

export default router;
