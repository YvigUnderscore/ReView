import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Role, UserStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { logAudit } from '../services/AuditService';
import { storage, StorageService } from '../services/StorageService';
import { getOnlineUserIds } from '../services/PresenceService';
import { toPublicUser } from '../lib/userView';
import { badRequest, notFound } from '../lib/errors';

const router = Router();

router.use(authenticate);

const publicUser = {
  id: true,
  email: true,
  name: true,
  firstName: true,
  lastName: true,
  username: true,
  role: true,
  status: true,
  lastSeenAt: true,
  avatarKey: true,
  storageUsed: true,
  storageLimit: true,
  createdAt: true,
} as const;

// Validation pseudo : lettres/chiffres/._- (sans espace)
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
  const users = await prisma.user.findMany({ select: publicUser, orderBy: { createdAt: 'asc' } });
  const online = new Set(getOnlineUserIds());
  const withView = await Promise.all(
    users.map(async (u) => ({ ...(await toPublicUser(u)), online: online.has(u.id) })),
  );
  res.json({ users: withView });
});

// GET /api/users/presence — présence de tous les utilisateurs (tout authentifié)
router.get('/presence', async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      firstName: true,
      lastName: true,
      username: true,
      avatarKey: true,
      status: true,
      lastSeenAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const online = new Set(getOnlineUserIds());
  const list = await Promise.all(
    users.map(async (u) => ({ ...(await toPublicUser(u)), online: online.has(u.id) })),
  );
  res.json({ users: list });
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
      email: z.string().email().max(254).optional(),
      password: passwordSchema.optional(),
    }),
  }),
  async (req, res) => {
    const me = req.user!.id;
    const body = req.body as {
      firstName?: string | null;
      lastName?: string | null;
      username?: string | null;
      email?: string;
      password?: string;
    };
    if (body.username) {
      const taken = await prisma.user.findFirst({
        where: { username: body.username, id: { not: me } },
        select: { id: true },
      });
      if (taken) throw badRequest('Pseudo déjà pris', 'USERNAME_TAKEN');
    }
    if (body.email) {
      const taken = await prisma.user.findFirst({
        where: { email: body.email, id: { not: me } },
        select: { id: true },
      });
      if (taken) throw badRequest('Email déjà utilisé', 'EMAIL_TAKEN');
    }
    const data: Record<string, unknown> = {};
    if (body.firstName !== undefined) data.firstName = body.firstName;
    if (body.lastName !== undefined) data.lastName = body.lastName;
    if (body.username !== undefined) data.username = body.username;
    if (body.email !== undefined) data.email = body.email;
    if (body.password !== undefined) data.password = await bcrypt.hash(body.password, 12);
    const user = await prisma.user.update({ where: { id: me }, data, select: publicUser });
    res.json({ user: await toPublicUser(user) });
  },
);

// PATCH /api/users/me/status — statut manuel (dispo/absent/ne pas déranger)
router.patch(
  '/me/status',
  validate({ body: z.object({ status: z.nativeEnum(UserStatus) }) }),
  async (req, res) => {
    const { status } = req.body as { status: UserStatus };
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { status },
      select: publicUser,
    });
    res.json({ user: await toPublicUser(user) });
  },
);

// POST /api/users/me/avatar/presign — URL présignée pour l'upload d'avatar
router.post(
  '/me/avatar/presign',
  validate({ body: z.object({ contentType: z.string().regex(/^image\/(png|jpe?g|webp)$/) }) }),
  async (req, res) => {
    const { contentType } = req.body as { contentType: string };
    const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
    const key = StorageService.avatarKey(req.user!.id, ext);
    const url = await storage.getPresignedPutUrl(key, contentType, 900);
    res.json({ url, key });
  },
);

// PUT /api/users/me/avatar — enregistre la clé après upload réussi
router.put(
  '/me/avatar',
  validate({ body: z.object({ key: z.string().max(256).nullable() }) }),
  async (req, res) => {
    const { key } = req.body as { key: string | null };
    // Sécurité : la clé doit cibler le dossier avatar de l'utilisateur courant
    if (key && !key.startsWith(`avatars/${req.user!.id}`)) throw badRequest('Clé avatar invalide', 'BAD_KEY');
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { avatarKey: key },
      select: publicUser,
    });
    res.json({ user: await toPublicUser(user) });
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
    const { email, password, name, firstName, lastName, username, role } = req.body as {
      email: string;
      password: string;
      name?: string;
      firstName?: string;
      lastName?: string;
      username?: string;
      role: Role;
    };
    if (await prisma.user.findUnique({ where: { email } }))
      throw badRequest('Email déjà utilisé', 'EMAIL_TAKEN');
    if (username && (await prisma.user.findUnique({ where: { username } })))
      throw badRequest('Pseudo déjà pris', 'USERNAME_TAKEN');
    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        password: hash,
        name: name ?? null,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        username: username ?? null,
        role,
      },
      select: publicUser,
    });
    logAudit({ userId: req.user!.id, action: 'USER_CREATE', entityType: 'User', entityId: user.id });
    res.status(201).json({ user: await toPublicUser(user) });
  },
);

// PATCH /api/users/:id/role — changement de rôle (admin)
router.patch(
  '/:id/role',
  requireRole(Role.ADMIN),
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: z.object({ role: z.nativeEnum(Role) }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const { role } = req.body as { role: Role };
    const exists = await prisma.user.findUnique({ where: { id } });
    if (!exists) throw notFound('Utilisateur introuvable');
    const user = await prisma.user.update({ where: { id }, data: { role }, select: publicUser });
    logAudit({
      userId: req.user!.id,
      action: 'USER_ROLE_CHANGE',
      entityType: 'User',
      entityId: id,
      metadata: { role },
    });
    res.json({ user: await toPublicUser(user) });
  },
);

// PATCH /api/users/:id — identité, email, mot de passe, rôle, quota (admin)
router.patch(
  '/:id',
  requireRole(Role.ADMIN),
  validate({
    params: z.object({ id: z.coerce.number().int() }),
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
    const id = Number(req.params.id);
    const exists = await prisma.user.findUnique({ where: { id } });
    if (!exists) throw notFound('Utilisateur introuvable');
    const body = req.body as {
      name?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      username?: string | null;
      email?: string;
      password?: string;
      role?: Role;
      storageLimit?: number | null;
    };
    if (body.username) {
      const taken = await prisma.user.findFirst({
        where: { username: body.username, id: { not: id } },
        select: { id: true },
      });
      if (taken) throw badRequest('Pseudo déjà pris', 'USERNAME_TAKEN');
    }
    if (body.email) {
      const taken = await prisma.user.findFirst({
        where: { email: body.email, id: { not: id } },
        select: { id: true },
      });
      if (taken) throw badRequest('Email déjà utilisé', 'EMAIL_TAKEN');
    }
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.firstName !== undefined) data.firstName = body.firstName;
    if (body.lastName !== undefined) data.lastName = body.lastName;
    if (body.username !== undefined) data.username = body.username;
    if (body.email !== undefined) data.email = body.email;
    if (body.password !== undefined) data.password = await bcrypt.hash(body.password, 12);
    if (body.role !== undefined) data.role = body.role;
    if (body.storageLimit !== undefined)
      data.storageLimit = body.storageLimit === null ? null : BigInt(body.storageLimit);
    const user = await prisma.user.update({ where: { id }, data, select: publicUser });
    logAudit({ userId: req.user!.id, action: 'USER_UPDATE', entityType: 'User', entityId: id });
    res.json({ user: await toPublicUser(user) });
  },
);

// DELETE /api/users/:id (admin)
router.delete(
  '/:id',
  requireRole(Role.ADMIN),
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user!.id) throw badRequest('Impossible de se supprimer soi-même');
    await prisma.user.delete({ where: { id } });
    logAudit({ userId: req.user!.id, action: 'USER_DELETE', entityType: 'User', entityId: id });
    res.status(204).end();
  },
);

export default router;
