// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, UserStatus } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as UserService from '../services/UserService';
import { revokeAllSessions } from '../lib/sessions';
import { logAudit } from '../services/AuditService';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });
// Validation pseudo : lettres/chiffres/._- (sans espace) ; mot de passe : ≥ 8, lettre + chiffre.
const usernameSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9._-]+$/, 'Pseudo invalide');
const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/[A-Za-z]/)
  .regex(/[0-9]/);

// GET /api/users — liste (admin/superviseur)
router.get('/', requireRole(Role.ADMIN, Role.SUPERVISOR), async (_req, res) => {
  res.json({ users: await UserService.listUsers() });
});

// GET /api/users/presence — présence de tous les utilisateurs (tout authentifié)
router.get('/presence', async (_req, res) => {
  res.json({ users: await UserService.listPresence() });
});

// ── Profil de l'utilisateur courant ──────────────────────────────────────────

// PATCH /api/users/me — édition de son propre profil
router.patch(
  '/me',
  validate({
    body: z.object({
      firstName: z.string().max(80).nullable().optional(),
      lastName: z.string().max(80).nullable().optional(),
      username: usernameSchema.nullable().optional(),
      jobTitle: z.string().max(120).nullable().optional(),
      bio: z.string().max(500).nullable().optional(),
      phone: z.string().max(40).nullable().optional(),
      email: z.string().email().max(254).optional(),
      password: passwordSchema.optional(),
    }),
  }),
  async (req, res) => {
    res.json({ user: await UserService.updateMe(req.user!.id, req.body) });
  },
);

// GET /api/users/me/preferences — préférences UI (vues kanban sauvegardées, etc.)
router.get('/me/preferences', async (req, res) => {
  res.json({ preferences: await UserService.getPreferences(req.user!.id) });
});

// PATCH /api/users/me/preferences — merge superficiel (clé à null = suppression)
router.patch(
  '/me/preferences',
  validate({ body: z.record(z.string().max(64), z.unknown()) }),
  async (req, res) => {
    res.json({ preferences: await UserService.updatePreferences(req.user!.id, req.body) });
  },
);

// PATCH /api/users/me/status — statut manuel (dispo/absent/ne pas déranger)
router.patch(
  '/me/status',
  validate({ body: z.object({ status: z.nativeEnum(UserStatus) }) }),
  async (req, res) => {
    res.json({ user: await UserService.setStatus(req.user!.id, req.body.status as UserStatus) });
  },
);

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

// ── Administration des comptes ───────────────────────────────────────────────

// POST /api/users — création par un admin (avec rôle)
router.post(
  '/',
  requireRole(Role.ADMIN),
  validate({
    body: z.object({
      email: z.string().email().max(254),
      password: passwordSchema,
      name: z.string().max(120).optional(),
      firstName: z.string().max(80).optional(),
      lastName: z.string().max(80).optional(),
      username: usernameSchema.optional(),
      role: z.nativeEnum(Role).default(Role.ARTIST),
    }),
  }),
  async (req, res) => {
    res.status(201).json({ user: await UserService.createUser(req.user!.id, req.body) });
  },
);

// PATCH /api/users/:id/role — changement de rôle (admin)
router.patch(
  '/:id/role',
  requireRole(Role.ADMIN),
  validate({ params: idParam, body: z.object({ role: z.nativeEnum(Role) }) }),
  async (req, res) => {
    const user = await UserService.changeRole(req.user!.id, Number(req.params.id), req.body.role as Role);
    res.json({ user });
  },
);

// PATCH /api/users/:id — identité, email, mot de passe, rôle, quota (admin)
router.patch(
  '/:id',
  requireRole(Role.ADMIN),
  validate({
    params: idParam,
    body: z.object({
      name: z.string().max(120).nullable().optional(),
      firstName: z.string().max(80).nullable().optional(),
      lastName: z.string().max(80).nullable().optional(),
      username: usernameSchema.nullable().optional(),
      email: z.string().email().max(254).optional(),
      password: passwordSchema.optional(),
      role: z.nativeEnum(Role).optional(),
      storageLimit: z.number().int().nonnegative().nullable().optional(),
    }),
  }),
  async (req, res) => {
    res.json({ user: await UserService.updateUser(req.user!.id, Number(req.params.id), req.body) });
  },
);

// DELETE /api/users/:id/sessions — révoque TOUTES les sessions d'un compte (admin, 36.B)
router.delete('/:id/sessions', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  const count = await revokeAllSessions(Number(req.params.id));
  logAudit({
    userId: req.user!.id,
    action: 'SESSION_REVOKE_ALL',
    entityType: 'User',
    entityId: Number(req.params.id),
    metadata: { count },
  });
  res.json({ revoked: count });
});

// DELETE /api/users/:id (admin)
router.delete('/:id', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  await UserService.deleteUser(req.user!.id, Number(req.params.id));
  res.status(204).end();
});

export default router;
