// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Role, UserStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logAudit } from './AuditService';
import * as InvitationService from './InvitationService';
import { storage, StorageService } from './StorageService';
import { getOnlineUserIds } from './PresenceService';
import { toPublicUser } from '../lib/userView';
import { normalizeEmail } from '../lib/email';
import { revokeAllCredentials } from '../lib/sessions';
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
  jobTitle: true,
  bio: true,
  phone: true,
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

/**
 * Liste complète (admin/superviseur) avec état en ligne.
 * Les comptes de service (tokens machine) sont exclus : ce sont des porteurs d'écritures,
 * pas des membres du studio — ils n'ont ni présence, ni adresse joignable.
 */
export async function listUsers() {
  const [users, pending] = await Promise.all([
    prisma.user.findMany({
      where: { isService: false },
      select: publicUser,
      orderBy: { createdAt: 'asc' },
    }),
    // Une seule requête pour toute la liste : un compte encore en attente d'activation se
    // signale dans l'annuaire, sinon on ne sait pas distinguer « invité » de « jamais venu ».
    prisma.invitation.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { userId: true },
    }),
  ]);
  const online = new Set(getOnlineUserIds());
  const invited = new Set(pending.map((i) => i.userId));
  return Promise.all(
    users.map(async (u) => ({
      ...(await toPublicUser(u)),
      online: online.has(u.id),
      invitePending: invited.has(u.id),
    })),
  );
}

/**
 * Présence de tous les utilisateurs — accessible à TOUT compte authentifié, y compris un
 * CLIENT externe. L'email est donc retiré de la réponse : `toPublicUser` recopie l'objet
 * qu'on lui passe (`...u`), il servait ici à calculer le nom d'affichage et repartait avec.
 * C'était l'annuaire complet du studio, adresses comprises, offert à n'importe quel invité.
 */
export async function listPresence() {
  const users = await prisma.user.findMany({
    where: { isService: false },
    select: {
      id: true,
      email: true, // nécessaire au repli displayName/initials — retiré de la sortie plus bas
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
  return Promise.all(
    users.map(async (u) => {
      const { email: _email, ...view } = await toPublicUser(u);
      return { ...view, online: online.has(u.id) };
    }),
  );
}

/**
 * Fiche publique d'un membre du studio — lisible par tout compte authentifié.
 *
 * Les coordonnées (email, téléphone) ne sont servies qu'aux comptes internes : un CLIENT
 * externe voit l'annuaire pour savoir à qui il parle en review, pas le carnet d'adresses
 * du studio. Les projets listés sont ceux que les deux personnes partagent — l'intersection
 * ne révèle donc rien que le lecteur ne voie déjà.
 */
export async function getProfile(viewerId: number, viewerRole: Role, id: number) {
  const user = await prisma.user.findFirst({ where: { id, isService: false }, select: publicUser });
  if (!user) throw notFound('Utilisateur introuvable');

  const shared =
    viewerId === id
      ? []
      : await prisma.project.findMany({
          where: {
            // Deux `memberships.some` ne peuvent pas cohabiter dans le même objet (le
            // second écraserait le premier) : l'intersection passe par un AND explicite.
            AND: [
              { memberships: { some: { userId: id } } },
              ...(viewerRole === Role.ADMIN || viewerRole === Role.SUPERVISOR
                ? []
                : [{ memberships: { some: { userId: viewerId } } }]),
            ],
          },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
          take: 20,
        });

  const isInternal = viewerRole !== Role.CLIENT;
  const view = await toPublicUser(user);
  return {
    ...view,
    email: isInternal ? view.email : undefined,
    phone: isInternal ? view.phone : undefined,
    // Le quota de stockage est une donnée d'administration, pas un élément de fiche.
    storageUsed: undefined,
    storageLimit: undefined,
    online: getOnlineUserIds().includes(id),
    sharedProjects: shared,
    isSelf: viewerId === id,
  };
}

export interface UpdateMeInput {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  jobTitle?: string | null;
  bio?: string | null;
  phone?: string | null;
  email?: string;
  password?: string;
}

export async function updateMe(userId: number, body: UpdateMeInput, keepSessionId?: string) {
  const email = body.email !== undefined ? normalizeEmail(body.email) : undefined;
  await assertUniqueIdentity(body.username || undefined, email, userId);
  const data: Record<string, unknown> = {};
  if (body.firstName !== undefined) data.firstName = body.firstName;
  if (body.lastName !== undefined) data.lastName = body.lastName;
  if (body.username !== undefined) data.username = body.username;
  if (body.jobTitle !== undefined) data.jobTitle = body.jobTitle;
  if (body.bio !== undefined) data.bio = body.bio;
  if (body.phone !== undefined) data.phone = body.phone;
  if (email !== undefined) data.email = email;
  if (body.password !== undefined) data.password = await bcrypt.hash(body.password, 12);
  const user = await prisma.user.update({ where: { id: userId }, data, select: publicUser });
  // Changer son mot de passe (ou son email, qui est l'identifiant de connexion) doit
  // couper les sessions ouvertes ailleurs : sinon un jeton volé survit à la reprise en
  // main du compte. La session courante est conservée pour ne pas déconnecter l'auteur.
  if (body.password !== undefined || email !== undefined) {
    await revokeAllCredentials(userId, keepSessionId);
  }
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
  /** Absent en mode invitation : la personne choisira le sien depuis le lien reçu. */
  password?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  role: Role;
}

/**
 * Crée un compte. Sans mot de passe, le compte naît inactivable autrement que par le lien
 * d'invitation envoyé par email : son mot de passe est un aléa que personne — pas même
 * l'administrateur qui vient de créer le compte — n'a jamais vu.
 */
export async function createUser(actorId: number, input: CreateUserInput) {
  const email = normalizeEmail(input.email);
  if (await prisma.user.findUnique({ where: { email } }))
    throw badRequest('Email déjà utilisé', 'EMAIL_TAKEN');
  if (input.username && (await prisma.user.findUnique({ where: { username: input.username } })))
    throw badRequest('Pseudo déjà pris', 'USERNAME_TAKEN');
  const byInvitation = input.password === undefined;
  // Relais et URL publique vérifiés AVANT la création : un compte créé puis privé de son
  // email d'activation ne serait joignable par personne, et son adresse resterait prise.
  if (byInvitation) await InvitationService.assertCanInvite();

  const hash = await bcrypt.hash(input.password ?? randomBytes(32).toString('hex'), 12);
  const user = await prisma.user.create({
    data: {
      email,
      password: hash,
      name: input.name ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      username: input.username ?? null,
      role: input.role,
    },
    select: publicUser,
  });
  if (byInvitation) {
    try {
      await InvitationService.sendInvitation(user.id, actorId);
    } catch (err) {
      // Le relais a lâché entre la vérification et l'envoi : on ne laisse pas derrière nous
      // un compte muet qui réserve l'adresse. L'administrateur retente quand c'est réparé.
      await prisma.user.delete({ where: { id: user.id } });
      throw err;
    }
  }
  logAudit({
    userId: actorId,
    action: 'USER_CREATE',
    entityType: 'User',
    entityId: user.id,
    metadata: { invited: byInvitation },
  });
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
  const email = body.email !== undefined ? normalizeEmail(body.email) : undefined;
  await assertUniqueIdentity(body.username || undefined, email, id);
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.firstName !== undefined) data.firstName = body.firstName;
  if (body.lastName !== undefined) data.lastName = body.lastName;
  if (body.username !== undefined) data.username = body.username;
  if (email !== undefined) data.email = email;
  if (body.password !== undefined) data.password = await bcrypt.hash(body.password, 12);
  if (body.role !== undefined) data.role = body.role;
  if (body.storageLimit !== undefined)
    data.storageLimit = body.storageLimit === null ? null : BigInt(body.storageLimit);
  const user = await prisma.user.update({ where: { id }, data, select: publicUser });
  logAudit({ userId: actorId, action: 'USER_UPDATE', entityType: 'User', entityId: id });
  // Un admin qui réinitialise un mot de passe, change l'email de connexion ou rétrograde
  // un rôle agit en général sur un compte compromis ou un départ : les jetons déjà émis
  // (qui portent l'ancien rôle) ne doivent pas survivre à l'opération.
  if (body.password !== undefined || email !== undefined || body.role !== undefined) {
    await revokeAllCredentials(id);
  }
  return toPublicUser(user);
}

export async function deleteUser(actorId: number, id: number) {
  if (id === actorId) throw badRequest('Impossible de se supprimer soi-même');
  // Les liens de partage sont en `SetNull` : supprimer le compte les laissait VIVANTS, et
  // désormais sans propriétaire — un départ ne coupait donc pas les accès publics ouverts
  // par la personne, alors que c'est précisément ce qu'on attend d'un offboarding.
  const revoked = await prisma.shareLink.updateMany({
    where: { createdById: id, revoked: false },
    data: { revoked: true },
  });
  await prisma.user.delete({ where: { id } });
  logAudit({
    userId: actorId,
    action: 'USER_DELETE',
    entityType: 'User',
    entityId: id,
    metadata: { revokedShareLinks: revoked.count },
  });
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
