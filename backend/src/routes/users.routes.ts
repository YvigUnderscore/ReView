// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, UserStatus } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as UserService from '../services/UserService';
import * as InvitationService from '../services/InvitationService';
import { revokeAllSessions } from '../lib/sessions';
import { logAudit } from '../services/AuditService';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });
// Username validation: letters, digits, `._-` (no space); password: at least 8 characters, a letter and a digit.
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

// GET /api/users — list (admin and supervisor)
router.get('/', requireRole(Role.ADMIN, Role.SUPERVISOR), async (_req, res) => {
  res.json({ users: await UserService.listUsers() });
});

// GET /api/users/presence — presence, bounded to what the requester is allowed to see
router.get('/presence', async (req, res) => {
  res.json({ users: await UserService.listPresence(req.user) });
});

// ── Current user's profile ──────────────────────────────────────────
// The public record of a member and the avatar live in `users-profile.routes`.

// PATCH /api/users/me — edits one's own profile
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
      /** Current password: required to change the password or the email. */
      currentPassword: z.string().max(128).optional(),
    }),
  }),
  async (req, res) => {
    // Changing the login identifier re-authenticates and remains forbidden to an API token: the rule lives in
    // the service, and the route only triggers it (10.D8).
    await UserService.assertCredentialChange(requireUser(req).id, req.body, Boolean(req.apiToken));
    res.json({ user: await UserService.updateMe(requireUser(req).id, req.body, req.sessionId) });
  },
);

// GET /api/users/me/preferences — UI preferences (saved kanban views, etc.)
router.get('/me/preferences', async (req, res) => {
  res.json({ preferences: await UserService.getPreferences(requireUser(req).id) });
});

// PATCH /api/users/me/preferences — shallow merge (a key set to null means deletion)
router.patch(
  '/me/preferences',
  // Value bounded in shape, depth and volume: the service handles the rest (A2-04).
  validate({ body: UserService.preferencesPatchSchema }),
  async (req, res) => {
    res.json({ preferences: await UserService.updatePreferences(requireUser(req).id, req.body) });
  },
);

// PATCH /api/users/me/status — manual status (available, away, do not disturb)
router.patch(
  '/me/status',
  validate({ body: z.object({ status: z.nativeEnum(UserStatus) }) }),
  async (req, res) => {
    res.json({ user: await UserService.setStatus(requireUser(req).id, req.body.status as UserStatus) });
  },
);

// ── Account administration ───────────────────────────────────────────────

// POST /api/users — creation by an admin (with role).
// Without `password`, the account goes into invitation: the person receives a link by email and chooses
// their own password. Providing both makes no sense: we decide.
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
    res.status(201).json({ user: await UserService.createUser(requireUser(req).id, req.body) });
  },
);

// POST /api/users/:id/invite — (re)sends an account's invitation (admin)
router.post('/:id/invite', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await InvitationService.sendInvitation(id, requireUser(req).id);
  logAudit({ userId: requireUser(req).id, action: 'USER_INVITE', entityType: 'User', entityId: id });
  res.json({ sent: true });
});

// PATCH /api/users/:id/role — role change (admin)
router.patch(
  '/:id/role',
  requireRole(Role.ADMIN),
  validate({ params: idParam, body: z.object({ role: z.nativeEnum(Role) }) }),
  async (req, res) => {
    const user = await UserService.changeRole(
      requireUser(req).id,
      Number(req.params.id),
      req.body.role as Role,
    );
    res.json({ user });
  },
);

// PATCH /api/users/:id — identity, email, password, role, quota (admin)
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
      /** Deactivation and reactivation of the account (reversible offboarding). */
      disabled: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    res.json({ user: await UserService.updateUser(requireUser(req).id, Number(req.params.id), req.body) });
  },
);

// DELETE /api/users/:id/sessions — revokes ALL the sessions of an account (admin, 36.B)
router.delete('/:id/sessions', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  const count = await revokeAllSessions(Number(req.params.id));
  logAudit({
    userId: requireUser(req).id,
    action: 'SESSION_REVOKE_ALL',
    entityType: 'User',
    entityId: Number(req.params.id),
    metadata: { count },
  });
  res.json({ revoked: count });
});

// DELETE /api/users/:id — deactivates the account (admin). `?hard=true` permanently deletes: the hard
// deletion takes along the author of the logged actions; it remains an explicit gesture.
router.delete(
  '/:id',
  requireRole(Role.ADMIN),
  // `z.coerce.boolean()` would make `?hard=false` true: on a permanent deletion, only the exact word
  // triggers it.
  validate({ params: idParam, query: z.object({ hard: z.enum(['true', 'false']).optional() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    if (req.query.hard === 'true') await UserService.deleteUser(requireUser(req).id, id);
    else await UserService.setDisabled(requireUser(req).id, id, true);
    res.status(204).end();
  },
);

export default router;
