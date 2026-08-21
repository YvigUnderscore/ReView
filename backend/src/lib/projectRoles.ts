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

/**
 * Rôle GLOBAL de gestion — **hors projet uniquement**.
 *
 * Réservé aux décisions qui ne portent sur aucun projet en particulier : périmètre d'une
 * liste transverse, portée annoncée d'un token. Toute décision qui concerne UN projet passe
 * par `effectiveProjectRole` : ce test-ci ignore l'élévation locale (38.E) — il refusait
 * à un ARTIST promu SUPERVISOR sur son projet de publier ce qu'il supervise, et laissait
 * un ARTIST rétrogradé CLIENT contribuer quand même.
 */
export const isGlobalManager = (role: Role): boolean => role === Role.ADMIN || role === Role.SUPERVISOR;

/**
 * Forme booléenne d'`assertProjectManage`, pour les règles « auteur OU manager » où le
 * refus n'est pas immédiat (modification/suppression d'une version, d'une tâche).
 */
export async function isProjectManager(
  userId: number,
  globalRole: Role,
  projectId: number,
): Promise<boolean> {
  return canManageProject(await effectiveProjectRole(userId, globalRole, projectId));
}

/** Le rôle effectif permet-il d'uploader / créer des tâches ? (CLIENT = lecture/commentaire seul.) */
export const canContribute = (role: Role | null): boolean => role != null && role !== Role.CLIENT;

/** Lève 403 si l'utilisateur ne peut pas gérer le projet (rôle effectif < SUPERVISOR). */
export async function assertProjectManage(
  userId: number,
  globalRole: Role,
  projectId: number,
): Promise<void> {
  const role = await effectiveProjectRole(userId, globalRole, projectId);
  if (!canManageProject(role)) throw forbidden('Managing the project is reserved to supervisors');
}

/** Lève 403 si l'utilisateur ne peut pas contribuer (CLIENT ou non-membre). */
export async function assertCanContribute(
  userId: number,
  globalRole: Role,
  projectId: number,
): Promise<void> {
  const role = await effectiveProjectRole(userId, globalRole, projectId);
  if (!canContribute(role))
    throw forbidden('Your role on this project does not allow this', 'ROLE_FORBIDDEN');
}
