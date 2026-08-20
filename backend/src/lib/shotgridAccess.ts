// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { prisma } from './prisma';
import { forbidden, notFound } from './errors';

/**
 * Droits d'accès aux écrans ShotGrid d'un projet.
 *
 * Configurer une connexion engage tout le projet — et, en écriture, le projet distant.
 * C'est donc réservé aux administrateurs et aux superviseurs membres du projet. La
 * lecture de l'état (« ce projet est relié, dernière synchronisation à telle heure »)
 * s'ouvre à tous les membres : les badges et les liens en dépendent.
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
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw notFound('Project not found');

  if (user.role === Role.ADMIN) return;
  if (options.adminOnly) throw forbidden('Administrators only');

  const membership = await prisma.projectMembership.findUnique({
    where: { userId_projectId: { userId: user.id, projectId } },
    select: { role: true },
  });
  if (!membership) throw forbidden('No access to this project');

  // Le rôle porté par l'appartenance prime sur le rôle global (10.D8).
  const effective = membership.role ?? user.role;
  if (options.allowMembers) {
    if (effective === Role.CLIENT) throw forbidden('Access denied');
    return;
  }
  if (effective !== Role.SUPERVISOR) throw forbidden('Supervisors and administrators only');
}

/** L'utilisateur peut-il piloter la connexion ShotGrid de ce projet ? (sans lever) */
export async function canManageShotgrid(user: SessionUser, projectId: number): Promise<boolean> {
  try {
    await assertProjectManager(user, projectId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Le compte peut-il créer des comptes de studio ?
 *
 * Rôle **global** uniquement. Un superviseur de projet — un compte ARTIST dont
 * l'appartenance porte `SUPERVISOR` — gère son projet, mais l'écran d'administration ne
 * lui donne pas le droit de fabriquer des comptes ; l'invitation depuis ShotGrid ne doit
 * pas le lui donner par la bande.
 */
export function canCreateStudioAccounts(user: SessionUser): boolean {
  return user.role === Role.ADMIN || user.role === Role.SUPERVISOR;
}
