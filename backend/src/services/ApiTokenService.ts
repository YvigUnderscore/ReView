// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ApiTokenKind, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateApiToken } from '../lib/apiTokens';
import { isGrantableScope } from '../lib/apiScopes';
import { badRequest, conflict, notFound } from '../lib/errors';
import { slugify } from '../lib/slug';
import { logAudit } from './AuditService';

/**
 * Tokens d'API (API v1) : émission, listing et révocation.
 *
 * Un token de service est adossé à un compte `User.isService` créé à la volée. Ce détour
 * par un vrai utilisateur est délibéré : toutes les écritures du produit référencent un
 * auteur (`authorId`, `uploaderId`, journal d'audit). Un token « sans utilisateur »
 * imposerait de rendre ces colonnes nullables et ferait disparaître la traçabilité —
 * on préfère un compte qui n'est une personne que sur le papier, incapable de se
 * connecter et jamais listé dans l'annuaire.
 */

/** Domaine réservé aux comptes de service : jamais routable, donc jamais joignable. */
const SERVICE_EMAIL_DOMAIN = 'service.review.invalid';

export const tokenSelect = {
  id: true,
  name: true,
  description: true,
  kind: true,
  scopes: true,
  projectId: true,
  lastUsedAt: true,
  expiresAt: true,
  createdAt: true,
} as const;

const expiryFrom = (days?: number): Date | null => (days ? new Date(Date.now() + days * 86_400_000) : null);

/** Rejette les scopes inconnus tôt, avec un message qui nomme le fautif. */
function assertScopes(scopes: readonly string[]): void {
  const unknown = scopes.filter((s) => !isGrantableScope(s));
  if (unknown.length > 0) throw badRequest(`Scopes inconnus : ${unknown.join(', ')}`, 'UNKNOWN_SCOPE');
}

/** Vérifie que le projet de cantonnement existe (et n'est pas à la corbeille). */
async function assertProjectExists(projectId: number): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true },
  });
  if (!project) throw notFound('Project not found');
}

export interface CreateTokenInput {
  name: string;
  description?: string;
  scopes: string[];
  expiresInDays?: number;
  projectId?: number;
}

/** Token personnel : agit au nom du porteur, avec le rôle de celui-ci. */
export async function createPersonal(userId: number, input: CreateTokenInput) {
  assertScopes(input.scopes);
  if (input.projectId !== undefined) await assertProjectExists(input.projectId);
  const { token, tokenHash } = generateApiToken();
  const created = await prisma.apiToken.create({
    data: {
      userId,
      createdById: userId,
      kind: ApiTokenKind.PERSONAL,
      name: input.name,
      description: input.description ?? null,
      tokenHash,
      scopes: input.scopes,
      projectId: input.projectId ?? null,
      expiresAt: expiryFrom(input.expiresInDays),
    },
    select: tokenSelect,
  });
  logAudit({
    userId,
    action: 'API_TOKEN_CREATE',
    entityType: 'ApiToken',
    entityId: created.id,
    metadata: { name: input.name, scopes: created.scopes, kind: 'PERSONAL' },
  });
  return { token, apiToken: created };
}

export interface CreateServiceTokenInput extends CreateTokenInput {
  /** Rôle porté par le compte de service. Jamais ADMIN : un robot ne gère pas le studio. */
  role?: Extract<Role, 'SUPERVISOR' | 'ARTIST' | 'CLIENT'>;
}

/**
 * Token de service : crée (ou retrouve) son compte porteur puis émet le token.
 * Réservé aux admins — l'appelant est responsable du contrôle de rôle.
 */
export async function createService(createdById: number, input: CreateServiceTokenInput) {
  assertScopes(input.scopes);
  if (input.projectId !== undefined) await assertProjectExists(input.projectId);

  const slug = slugify(input.name);
  if (!slug) throw badRequest('Invalid service name (no usable character)');
  const email = `svc-${slug}@${SERVICE_EMAIL_DOMAIN}`;

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, isService: true } });
  if (existing && !existing.isService) throw conflict('A regular account already uses this address');

  // Mot de passe aléatoire jamais communiqué : le compte reste inutilisable en connexion
  // (le login refuse `isService`), et il n'existe aucun secret « par défaut » à deviner.
  const serviceUser =
    existing ??
    (await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(randomBytes(32).toString('hex'), 12),
        name: input.name,
        role: input.role ?? Role.ARTIST,
        isService: true,
      },
      select: { id: true, isService: true },
    }));

  // Un compte de service réutilisé peut voir son rôle ajusté à l'émission suivante.
  if (existing && input.role) {
    await prisma.user.update({ where: { id: serviceUser.id }, data: { role: input.role } });
  }

  // Un token cantonné à un projet suppose que son compte y soit membre : sans cela, un
  // compte de service ARTIST ne verrait rien du projet qu'il est censé alimenter.
  if (input.projectId !== undefined) {
    await prisma.projectMembership.upsert({
      where: { userId_projectId: { userId: serviceUser.id, projectId: input.projectId } },
      create: { userId: serviceUser.id, projectId: input.projectId },
      update: {},
    });
  }

  const { token, tokenHash } = generateApiToken();
  const created = await prisma.apiToken.create({
    data: {
      userId: serviceUser.id,
      createdById,
      kind: ApiTokenKind.SERVICE,
      name: input.name,
      description: input.description ?? null,
      tokenHash,
      scopes: input.scopes,
      projectId: input.projectId ?? null,
      expiresAt: expiryFrom(input.expiresInDays),
    },
    select: tokenSelect,
  });
  logAudit({
    userId: createdById,
    action: 'API_TOKEN_CREATE',
    entityType: 'ApiToken',
    entityId: created.id,
    metadata: { name: input.name, scopes: created.scopes, kind: 'SERVICE', serviceUserId: serviceUser.id },
  });
  return { token, apiToken: created };
}

/** Tokens de service actifs du studio (jamais le secret). */
export async function listService() {
  return prisma.apiToken.findMany({
    where: { kind: ApiTokenKind.SERVICE, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { ...tokenSelect, user: { select: { id: true, email: true, role: true } } },
  });
}

/** Révoque un token de service. Le compte porteur survit : ses écritures gardent un auteur. */
export async function revokeService(actorId: number, id: number): Promise<void> {
  const r = await prisma.apiToken.updateMany({
    where: { id, kind: ApiTokenKind.SERVICE, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (r.count === 0) throw notFound('Token not found');
  logAudit({ userId: actorId, action: 'API_TOKEN_REVOKE', entityType: 'ApiToken', entityId: id });
}
