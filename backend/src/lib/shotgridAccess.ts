// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { prisma } from './prisma';
import { forbidden, notFound } from './errors';

/**
 * Access rights to a project's ShotGrid screens.
 *
 * Configuring a connection commits the whole project — and, on write, the remote project. It is therefore reserved for administrators and supervisors who are members
 * of the project. Reading the status ("this project is linked, last synchronised at such a time") is open to all members: the badges and links depend on it.
 */

export interface SessionUser {
  id: number;
  role: Role;
}

export async function assertProjectManager(
  user: SessionUser,
  projectId: number,
  options: { allowMembers?: boolean; adminOnly?: boolean } = {},
): Promise<void> {
  // Same invariant as `middleware/rbac`: a project put in the trash no longer exists. Here the stakes go beyond reading — these screens trigger synchronisations, hence
  // WRITES to the studio's ShotGrid site. Pushing statuses or notes for a project the studio has just removed cannot be recovered on the remote side.
  const project = await prisma.project.findUnique({
    where: { id: projectId, deletedAt: null },
    select: { id: true },
  });
  if (!project) throw notFound('Project not found');

  if (user.role === Role.ADMIN) return;
  if (options.adminOnly) throw forbidden('Administrators only');

  const membership = await prisma.projectMembership.findUnique({
    where: { userId_projectId: { userId: user.id, projectId } },
    select: { role: true },
  });
  if (!membership) throw forbidden('No access to this project');

  // The role carried by the membership takes precedence over the global role (10.D8).
  const effective = membership.role ?? user.role;
  if (options.allowMembers) {
    if (effective === Role.CLIENT) throw forbidden('Access denied');
    return;
  }
  if (effective !== Role.SUPERVISOR) throw forbidden('Supervisors and administrators only');
}

/** Can the user drive this project's ShotGrid connection? (without throwing) */
export async function canManageShotgrid(user: SessionUser, projectId: number): Promise<boolean> {
  try {
    await assertProjectManager(user, projectId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Can the account create studio accounts?
 *
 * **Global** role only. A project supervisor — an ARTIST account whose membership carries `SUPERVISOR` — manages their project, but the administration screen does not
 * give them the right to create accounts; the invitation from ShotGrid must not grant it to them through the back door.
 */
export function canCreateStudioAccounts(user: SessionUser): boolean {
  return user.role === Role.ADMIN || user.role === Role.SUPERVISOR;
}
