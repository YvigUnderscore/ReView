// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ApiTokenKind, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateApiToken } from '../lib/apiTokens';
import { isGrantableScope } from '../lib/apiScopes';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { slugify } from '../lib/slug';
import { logAudit } from './AuditService';

/**
 * API tokens (API v1): issuance, listing and revocation.
 *
 * A service token is backed by a `User.isService` account created on the fly. This detour through a real
 * user is deliberate: every write in the product references an author (`authorId`, `uploaderId`, audit
 * log). A "userless" token would force those columns to be nullable and would erase traceability; we
 * prefer an account that is a person only on paper, unable to log in and never listed in the directory.
 */

/** Domain reserved for service accounts: never routable, hence never reachable. */
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

/** Rejects unknown scopes early, with a message naming the offender. */
function assertScopes(scopes: readonly string[]): void {
  const unknown = scopes.filter((s) => !isGrantableScope(s));
  if (unknown.length > 0) throw badRequest(`Unknown scopes: ${unknown.join(', ')}`, 'UNKNOWN_SCOPE');
}

/**
 * Re-authenticates the issuer before forging a durable identity.
 *
 * A `rvk_` lives up to 3650 days and survives closing the tab: forged from a stolen access token, it turns
 * a passing session theft into permanent access. The password is the one thing the attacker does not have.
 *
 * The refusal is a **403** and not a 401: a 401 would trigger session renewal on the client side
 * (`lib/apiClient`), which purges the session when it fails. A typo would log the user out. Here the caller
 * is indeed authenticated; it is the action that is refused.
 */
export async function assertActorPassword(userId: number, password?: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
  const ok = user !== null && password !== undefined && (await bcrypt.compare(password, user.password));
  if (!ok) throw forbidden('The current password is required', 'CURRENT_PASSWORD_REQUIRED');
}

/** Checks that the scoping project exists (and is not in the trash). */
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

/** Personal token: acts on behalf of the bearer, with the bearer's role. */
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

/** Active personal tokens of an account (never the secret), newest first. */
export function listPersonal(userId: number) {
  return prisma.apiToken.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: tokenSelect,
  });
}

/** Revokes one of the account's own tokens; another account's token is a 404, not a 403. */
export async function revokePersonal(userId: number, id: number): Promise<void> {
  const r = await prisma.apiToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (r.count === 0) throw notFound('Token not found');
  logAudit({ userId, action: 'API_TOKEN_REVOKE', entityType: 'ApiToken', entityId: id });
}

export interface CreateServiceTokenInput extends CreateTokenInput {
  /** Role carried by the service account. Never ADMIN: a bot does not manage the studio. */
  role?: Extract<Role, 'SUPERVISOR' | 'ARTIST' | 'CLIENT'>;
}

/**
 * Service token: creates (or finds) its bearer account, then issues the token.
 * Reserved to admins: the caller is responsible for the role check.
 */
export async function createService(createdById: number, input: CreateServiceTokenInput) {
  assertScopes(input.scopes);
  if (input.projectId !== undefined) await assertProjectExists(input.projectId);

  const slug = slugify(input.name);
  if (!slug) throw badRequest('Invalid service name (no usable character)');
  const email = `svc-${slug}@${SERVICE_EMAIL_DOMAIN}`;

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, isService: true } });
  if (existing && !existing.isService) throw conflict('A regular account already uses this address');

  // Random password, never communicated: the account remains unusable for logging in (login refuses
  // `isService`), and there is no "default" secret to guess.
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

  // A reused service account may have its role adjusted on the next issuance.
  if (existing && input.role) {
    await prisma.user.update({ where: { id: serviceUser.id }, data: { role: input.role } });
  }

  // A token scoped to a project assumes its account is a member of it: without this, an ARTIST service
  // account would see nothing of the project it is meant to feed.
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

/**
 * Active service tokens of the studio (never the secret).
 *
 * The effective role comes from the bearer account and the scoping of the linked project: these are the
 * two answers the admin is looking for in front of the list ("what can this bot do, and where?"); they are
 * served with the row rather than making the screen guess.
 */
export async function listService() {
  return prisma.apiToken.findMany({
    where: { kind: ApiTokenKind.SERVICE, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      ...tokenSelect,
      user: { select: { id: true, email: true, role: true } },
      project: { select: { id: true, name: true } },
    },
  });
}

/** Revokes a service token. The bearer account survives: its writes keep an author. */
export async function revokeService(actorId: number, id: number): Promise<void> {
  const r = await prisma.apiToken.updateMany({
    where: { id, kind: ApiTokenKind.SERVICE, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (r.count === 0) throw notFound('Token not found');
  logAudit({ userId: actorId, action: 'API_TOKEN_REVOKE', entityType: 'ApiToken', entityId: id });
}
