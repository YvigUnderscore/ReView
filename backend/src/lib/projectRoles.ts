// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { prisma } from './prisma';
import { forbidden } from './errors';

/**
 * Rôles par projet (38.E) — étend le RBAC global d'un niveau local :
 *  - ADMIN global : insensible au membership, ADMIN partout.
 *  - SUPERVISOR global : accès de gestion global (membership ignoré, reste SUPERVISOR).
 *  - autres rôles : accès UNIQUEMENT via membership ; le rôle effectif est
 *    `membership.role ?? rôle global` — d'où l'élévation locale (un ARTIST membre avec
 *    `membership.role = SUPERVISOR` gère CE projet sans droit global).
 *
 * Le rôle effectif ne rétrograde jamais un manager global (pas de piège cross-projet).
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
  if (!membership) return null; // pas membre → aucun accès
  return membership.role ?? globalRole;
}

/** Le rôle effectif permet-il de gérer le projet (structure, membres, réglages) ? */
export const canManageProject = (role: Role | null): boolean =>
  role === Role.ADMIN || role === Role.SUPERVISOR;

/** Le rôle effectif permet-il d'uploader / créer des tâches ? (CLIENT = lecture/commentaire seul.) */
export const canContribute = (role: Role | null): boolean => role != null && role !== Role.CLIENT;

/** Lève 403 si l'utilisateur ne peut pas gérer le projet (rôle effectif < SUPERVISOR). */
export async function assertProjectManage(
  userId: number,
  globalRole: Role,
  projectId: number,
): Promise<void> {
  const role = await effectiveProjectRole(userId, globalRole, projectId);
  if (!canManageProject(role)) throw forbidden('Gestion du projet réservée aux superviseurs');
}

/** Lève 403 si l'utilisateur ne peut pas contribuer (CLIENT ou non-membre). */
export async function assertCanContribute(
  userId: number,
  globalRole: Role,
  projectId: number,
): Promise<void> {
  const role = await effectiveProjectRole(userId, globalRole, projectId);
  if (!canContribute(role))
    throw forbidden('Action non autorisée pour votre rôle sur ce projet', 'ROLE_FORBIDDEN');
}
