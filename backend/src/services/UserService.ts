import bcrypt from 'bcryptjs';
import { Role, UserStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logAudit } from './AuditService';
import { storage, StorageService } from './StorageService';
import { getOnlineUserIds } from './PresenceService';
import { toPublicUser } from '../lib/userView';
import { badRequest, notFound } from '../lib/errors';

/**
 * Logique métier des utilisateurs (profil, présence, administration des comptes).
 * Les routes ne font que valider (RBAC + Zod) → appeler → répondre (10.D8).
 */

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

/** Refuse un pseudo/email déjà pris par un autre utilisateur (excludeId = compte édité). */
async function assertUniqueIdentity(
  username: string | undefined,
  email: string | undefined,
  excludeId: number,
) {
  if (username) {
    const taken = await prisma.user.findFirst({
      where: { username, id: { not: excludeId } },
      select: { id: true },
    });
    if (taken) throw badRequest('Pseudo déjà pris', 'USERNAME_TAKEN');
  }
  if (email) {
    const taken = await prisma.user.findFirst({
      where: { email, id: { not: excludeId } },
      select: { id: true },
    });
    if (taken) throw badRequest('Email déjà utilisé', 'EMAIL_TAKEN');
  }
}

/** Liste complète (admin/superviseur) avec état en ligne. */
export async function listUsers() {
  const users = await prisma.user.findMany({ select: publicUser, orderBy: { createdAt: 'asc' } });
  const online = new Set(getOnlineUserIds());
  return Promise.all(users.map(async (u) => ({ ...(await toPublicUser(u)), online: online.has(u.id) })));
}

/** Présence de tous les utilisateurs (tout authentifié). */
export async function listPresence() {
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
  return Promise.all(users.map(async (u) => ({ ...(await toPublicUser(u)), online: online.has(u.id) })));
}

export interface UpdateMeInput {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string;
  password?: string;
}

export async function updateMe(userId: number, body: UpdateMeInput) {
  await assertUniqueIdentity(body.username || undefined, body.email, userId);
  const data: Record<string, unknown> = {};
  if (body.firstName !== undefined) data.firstName = body.firstName;
  if (body.lastName !== undefined) data.lastName = body.lastName;
  if (body.username !== undefined) data.username = body.username;
  if (body.email !== undefined) data.email = body.email;
  if (body.password !== undefined) data.password = await bcrypt.hash(body.password, 12);
  const user = await prisma.user.update({ where: { id: userId }, data, select: publicUser });
  return toPublicUser(user);
}

export async function setStatus(userId: number, status: UserStatus) {
  const user = await prisma.user.update({ where: { id: userId }, data: { status }, select: publicUser });
  return toPublicUser(user);
}

export async function presignAvatar(userId: number, contentType: string) {
  const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
  const key = StorageService.avatarKey(userId, ext);
  const url = await storage.getPresignedPutUrl(key, contentType, 900);
  return { url, key };
}

export async function setAvatar(userId: number, key: string | null) {
  // Sécurité : la clé doit cibler le dossier avatar de l'utilisateur courant.
  if (key && !key.startsWith(`avatars/${userId}`)) throw badRequest('Clé avatar invalide', 'BAD_KEY');
  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatarKey: key },
    select: publicUser,
  });
  return toPublicUser(user);
}

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  role: Role;
}

export async function createUser(actorId: number, input: CreateUserInput) {
  if (await prisma.user.findUnique({ where: { email: input.email } }))
    throw badRequest('Email déjà utilisé', 'EMAIL_TAKEN');
  if (input.username && (await prisma.user.findUnique({ where: { username: input.username } })))
    throw badRequest('Pseudo déjà pris', 'USERNAME_TAKEN');
  const hash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      password: hash,
      name: input.name ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      username: input.username ?? null,
      role: input.role,
    },
    select: publicUser,
  });
  logAudit({ userId: actorId, action: 'USER_CREATE', entityType: 'User', entityId: user.id });
  return toPublicUser(user);
}

export async function changeRole(actorId: number, id: number, role: Role) {
  if (!(await prisma.user.findUnique({ where: { id } }))) throw notFound('Utilisateur introuvable');
  const user = await prisma.user.update({ where: { id }, data: { role }, select: publicUser });
  logAudit({
    userId: actorId,
    action: 'USER_ROLE_CHANGE',
    entityType: 'User',
    entityId: id,
    metadata: { role },
  });
  return toPublicUser(user);
}

export interface AdminUpdateUserInput extends UpdateMeInput {
  name?: string | null;
  role?: Role;
  storageLimit?: number | null;
}

export async function updateUser(actorId: number, id: number, body: AdminUpdateUserInput) {
  if (!(await prisma.user.findUnique({ where: { id } }))) throw notFound('Utilisateur introuvable');
  await assertUniqueIdentity(body.username || undefined, body.email, id);
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
  logAudit({ userId: actorId, action: 'USER_UPDATE', entityType: 'User', entityId: id });
  return toPublicUser(user);
}

export async function deleteUser(actorId: number, id: number) {
  if (id === actorId) throw badRequest('Impossible de se supprimer soi-même');
  await prisma.user.delete({ where: { id } });
  logAudit({ userId: actorId, action: 'USER_DELETE', entityType: 'User', entityId: id });
}

// ── Préférences UI (JSON libre par utilisateur : vues kanban, etc.) ──────────

const PREFERENCES_MAX_BYTES = 32_768;

export async function getPreferences(userId: number): Promise<Record<string, unknown>> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
  if (!u) throw notFound('Utilisateur introuvable');
  return (u.preferences ?? {}) as Record<string, unknown>;
}

/** Merge superficiel : clé à `null` = suppression ; taille totale bornée. */
export async function updatePreferences(
  userId: number,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = { ...(await getPreferences(userId)) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  if (JSON.stringify(next).length > PREFERENCES_MAX_BYTES)
    throw badRequest('Préférences trop volumineuses', 'PREFERENCES_TOO_LARGE');
  await prisma.user.update({
    where: { id: userId },
    data: { preferences: next as object },
  });
  return next;
}
