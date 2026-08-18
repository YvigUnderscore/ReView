// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Role, UserStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { forbidden, unauthorized } from '../lib/errors';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as UserService from '../services/UserService';
import * as InvitationService from '../services/InvitationService';
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

// GET /api/users/presence — présence, cantonnée à ce que le demandeur a le droit de voir
router.get('/presence', async (req, res) => {
  res.json({ users: await UserService.listPresence(req.user) });
});

// ── Profil de l'utilisateur courant ──────────────────────────────────────────
// La fiche publique d'un membre et l'avatar vivent dans `users-profile.routes`.

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
      /** Mot de passe actuel — exigé pour modifier le mot de passe ou l'email. */
      currentPassword: z.string().max(128).optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as { email?: string; password?: string; currentPassword?: string };
    const changesCredentials = body.password !== undefined || body.email !== undefined;

    if (changesCredentials) {
      // Un token d'API (36.C) est un secret d'automatisation, souvent en clair dans un CI :
      // lui laisser changer le mot de passe et l'email de connexion en ferait un chemin de
      // prise de contrôle complète du compte — 2FA comprise, puisqu'aucun facteur n'est
      // redemandé. Ces deux champs restent réservés à une vraie session interactive.
      if (req.apiToken) {
        throw forbidden(
          "Un token d'API ne peut pas modifier le mot de passe ni l'email",
          'API_TOKEN_FORBIDDEN',
        );
      }
      // Re-authentification : un jeton volé ne doit pas suffire à verrouiller le compte.
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user) throw unauthorized();
      if (!body.currentPassword || !(await bcrypt.compare(body.currentPassword, user.password))) {
        throw unauthorized('The current password is required', 'CURRENT_PASSWORD_REQUIRED');
      }
    }

    res.json({ user: await UserService.updateMe(req.user!.id, req.body, req.sessionId) });
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

// ── Administration des comptes ───────────────────────────────────────────────

// POST /api/users — création par un admin (avec rôle).
// Sans `password`, le compte part en invitation : la personne reçoit un lien par email et
// choisit elle-même son mot de passe. Fournir les deux n'a pas de sens — on tranche.
router.post(
  '/',
  requireRole(Role.ADMIN),
  validate({
    body: z.object({
      email: z.string().email().max(254),
      password: passwordSchema.optional(),
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

// POST /api/users/:id/invite — (re)envoie l'invitation d'un compte (admin)
router.post('/:id/invite', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await InvitationService.sendInvitation(id, req.user!.id);
  logAudit({ userId: req.user!.id, action: 'USER_INVITE', entityType: 'User', entityId: id });
  res.json({ sent: true });
});

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
