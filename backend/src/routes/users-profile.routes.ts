// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { badRequest } from '../lib/errors';
import * as UserService from '../services/UserService';

/**
 * A member's record and avatar: mounted on `/api/users`, before the administration routes so that
 * `/me/avatar` is not swallowed by `/:id`. Separate from `users.routes`, which already holds the whole
 * lifecycle of accounts (200-line budget per router).
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/**
 * The only avatar key form accepted: the one that `presignAvatar` has just produced, `avatars/<id>.<ext>`.
 * The pattern is **anchored** and the identifier compared whole.
 *
 * An open prefix (`key.startsWith('avatars/' + id)`) does not close the comparison: in decimal, `9` is a
 * prefix of `91`, so account 9 designated the avatar of account 91. The two twin checks of the code (entity
 * thumbnail, department image), for their part, close on the separator dot: it is that version which is
 * authoritative.
 */
const AVATAR_KEY_RE = /^avatars\/(\d+)\.(?:png|jpe?g|webp)$/;
const ownsAvatarKey = (key: string, userId: number): boolean =>
  AVATAR_KEY_RE.exec(key)?.[1] === String(userId);

// GET /api/users/:id/profile — public record of a member (any authenticated account)
router.get('/:id/profile', validate({ params: idParam }), async (req, res) => {
  const profile = await UserService.getProfile(req.user!.id, req.user!.role, Number(req.params.id));
  res.json({ user: profile });
});

// POST /api/users/me/avatar/presign — presigned URL for the avatar upload
router.post(
  '/me/avatar/presign',
  validate({ body: z.object({ contentType: z.string().regex(/^image\/(png|jpe?g|webp)$/) }) }),
  async (req, res) => {
    res.json(await UserService.presignAvatar(req.user!.id, req.body.contentType));
  },
);

// PUT /api/users/me/avatar — records the key after a successful upload
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
