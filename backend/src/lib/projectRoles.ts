// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { prisma } from './prisma';
import { forbidden } from './errors';

/**
 * Per-project roles (38.E) — extends global RBAC by one local level:
 *  - global ADMIN: insensitive to membership, ADMIN everywhere.
 *  - global SUPERVISOR: global management access (membership ignored, remains SUPERVISOR).
 *  - other roles: access ONLY via membership; the effective role is
 *    `membership.role ?? global role` — hence local elevation (an ARTIST member with
 *    `membership.role = SUPERVISOR` manages THIS project without a global right).
 *
 * The effective role never demotes a global manager (no cross-project trap).
 */
export async function effectiveProjectRole(
  userId: number,
  globalRole: Role,
  projectId: number,
): Promise<Role | null> {
  if (globalRole === Role.ADMIN) return Role.ADMIN;
  if (globalRole === Role.SUPERVISOR) return Role.SUPERVISOR;
  const membership = await prisma.projectMembership.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  if (!membership) return null; // not a member → no access
  return membership.role ?? globalRole;
}

/** Does the effective role allow managing the project (structure, members, settings)? */
export const canManageProject = (role: Role | null): boolean =>
  role === Role.ADMIN || role === Role.SUPERVISOR;

/**
 * GLOBAL management role — **outside of a project only**.
 *
 * Reserved for decisions that concern no particular project: scope of a cross-project list, announced scope of a token. Any
 * decision concerning ONE project goes through `effectiveProjectRole`: this test ignores local elevation (38.E) — it refused
 * an ARTIST promoted to SUPERVISOR on their project from publishing what they supervise, and let a CLIENT-demoted ARTIST
 * contribute anyway.
 */
export const isGlobalManager = (role: Role): boolean => role === Role.ADMIN || role === Role.SUPERVISOR;

/**
 * Boolean form of `assertProjectManage`, for the "author OR manager" rules where refusal is not immediate
 * (modifying/deleting a version or a task).
 */
export async function isProjectManager(
  userId: number,
  globalRole: Role,
  projectId: number,
): Promise<boolean> {
  return canManageProject(await effectiveProjectRole(userId, globalRole, projectId));
}

/** Does the effective role allow uploading / creating tasks? (CLIENT = read/comment only.) */
export const canContribute = (role: Role | null): boolean => role != null && role !== Role.CLIENT;

/** Throws 403 if the user cannot manage the project (effective role < SUPERVISOR). */
export async function assertProjectManage(
  userId: number,
  globalRole: Role,
  projectId: number,
): Promise<void> {
  const role = await effectiveProjectRole(userId, globalRole, projectId);
  if (!canManageProject(role)) throw forbidden('Managing the project is reserved to supervisors');
}

/** Throws 403 if the user cannot contribute (CLIENT or non-member). */
export async function assertCanContribute(
  userId: number,
  globalRole: Role,
  projectId: number,
): Promise<void> {
  const role = await effectiveProjectRole(userId, globalRole, projectId);
  if (!canContribute(role))
    throw forbidden('Your role on this project does not allow this', 'ROLE_FORBIDDEN');
}
