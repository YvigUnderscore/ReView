// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { forbidden, notFound, unauthorized } from '../lib/errors';
import { effectiveProjectRole, canManageProject, canContribute } from '../lib/projectRoles';

/**
 * What the caller is going to DO with the project.
 *
 * Root of the 38.E/A1-03 defect: the access guard only granted on the existence of the
 * `ProjectMembership` and ignored its `role` field. Every caller that wrote therefore had to
 * *remember* to add `assertCanContribute` behind it, and three had forgotten (timeline markers,
 * media management, the board). A guard you must remember to double is not a guard: it is a
 * convention.
 *
 * The intent makes the role mandatory at the right place. `read` remains the default (a member
 * CLIENT reads and comments, that is their job); `write` requires the ability to contribute;
 * `manage` requires the management role. In all three cases it is the EFFECTIVE role on THIS
 * project that decides (`lib/projectRoles`), local elevation and demotion included.
 */
export type ProjectAccessIntent = 'read' | 'write' | 'manage';

/**
 * Options of a project access check.
 *
 * `includeTrashed` is the ONLY exception to the trash invariant, and it is reserved for the entry
 * points that explicitly deal with the trash: listing removed projects, restoring one, purging one.
 * Everywhere else the option stays absent: a case-by-case "if admin" exception would reopen the door
 * this guard closes.
 */
export interface ProjectAccessOptions {
  includeTrashed?: boolean;
  intent?: ProjectAccessIntent;
}

/**
 * Verdict of a project access check. The refusal states its nature so the caller can pick the right
 * code: 404 when the project is not addressable, 403 when it is but the person does not belong to it
 * or their role does not carry the intent.
 */
export type ProjectAccessOutcome = 'granted' | 'not-member' | 'unavailable' | 'insufficient-role';

/**
 * Requires the authenticated user to hold one of the given roles.
 * To be used after `authenticate`.
 */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Non authentifié' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Access denied : privilèges insuffisants' });
      return;
    }
    next();
  };

/**
 * Is the project addressable? It must exist and, outside a "trash" entry point, must not have been
 * put in the trash.
 */
const projectIsAddressable = async (projectId: number, includeTrashed: boolean): Promise<boolean> =>
  (await prisma.project.count({
    where: { id: projectId, ...(includeTrashed ? {} : { deletedAt: null }) },
  })) > 0;

/**
 * Resolves a user's access to a project.
 *
 * **Invariant: a project put in the trash no longer exists for the RBAC.** The lists already filtered
 * it (`deletedAt: null`), but the membership guard only looked at the membership: a media, a shot, a
 * sequence or an asset of a removed project remained reachable by knowing its URL, and removal could
 * be bypassed. The refusal is a 404, not a 403: a removed project must not be guessable any more than
 * a project that never existed.
 *
 * Otherwise the v2 rules are unchanged: ADMIN and SUPERVISOR have global access, the others go through
 * their `ProjectMembership`.
 *
 * **The EFFECTIVE role is read here**, not just the existence of the membership: this is what lets
 * `intent` decide without the caller having to double the guard (38.E). For global access
 * (ADMIN/SUPERVISOR), `effectiveProjectRole` answers without querying the membership, so the query
 * cost is unchanged.
 */
export const resolveProjectAccess = async (
  userId: number,
  role: Role,
  projectId: number,
  { includeTrashed = false, intent = 'read' }: ProjectAccessOptions = {},
): Promise<ProjectAccessOutcome> => {
  if (!(await projectIsAddressable(projectId, includeTrashed))) return 'unavailable';
  const effective = await effectiveProjectRole(userId, role, projectId);
  if (effective === null) return 'not-member';
  if (intent === 'write' && !canContribute(effective)) return 'insufficient-role';
  if (intent === 'manage' && !canManageProject(effective)) return 'insufficient-role';
  return 'granted';
};

/**
 * Boolean form of `resolveProjectAccess`, for callers that formulate the refusal themselves
 * (batch checks, resolutions by identifier).
 */
export const checkProjectAccess = async (
  userId: number,
  role: Role,
  projectId: number,
  options?: ProjectAccessOptions,
): Promise<boolean> => (await resolveProjectAccess(userId, role, projectId, options)) === 'granted';

/**
 * Typed error matching a refusal verdict. The 404 stays generic (message and fallback code): naming
 * the project in the response would cancel the benefit of the 404.
 *
 * A ROLE refusal is distinguished from a MEMBERSHIP refusal: it carries the code `ROLE_FORBIDDEN` (the
 * same as `assertCanContribute`), otherwise the interface would tell someone who can see the project
 * perfectly well but does not write to it that they have "no access to this project".
 */
const projectAccessError = (
  outcome: Exclude<ProjectAccessOutcome, 'granted'>,
  intent: ProjectAccessIntent,
): Error => {
  if (outcome === 'unavailable') return notFound();
  if (outcome === 'not-member') return forbidden('No access to this project');
  return intent === 'manage'
    ? forbidden('Managing the project is reserved to supervisors')
    : forbidden('Your role on this project does not allow this', 'ROLE_FORBIDDEN');
};

/**
 * Project access middleware: reads the project id from `req.params.projectId`.
 */
export const requireProjectAccess = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Non authentifié' });
    return;
  }
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) {
    res.status(400).json({ error: 'projectId invalide' });
    return;
  }
  const outcome = await resolveProjectAccess(req.user.id, req.user.role, projectId);
  // Typed error rather than a response written here: the global handler standardizes `{error, code}`,
  // the only way for the interface to display the refusal in the reader's language.
  next(outcome === 'granted' ? undefined : projectAccessError(outcome, 'read'));
};

/**
 * Variant usable in a handler: throws an AppError (caught by the global handler) if the user has no
 * access to the project. `req.user` is assumed present (after authenticate).
 *
 * A handler that WRITES passes `{ intent: 'write' }`: the guard then checks the effective role itself,
 * instead of relying on the call to `assertCanContribute` that three write paths had forgotten (A1-03).
 */
export const assertProjectAccess = async (
  req: Request,
  projectId: number,
  options?: ProjectAccessOptions,
): Promise<void> => {
  if (!req.user) throw unauthorized();
  const outcome = await resolveProjectAccess(req.user.id, req.user.role, projectId, options);
  if (outcome !== 'granted') throw projectAccessError(outcome, options?.intent ?? 'read');
};

/**
 * Project management (38.E): reads `req.params.projectId` and authorizes if the user's EFFECTIVE role
 * on this project is ADMIN/SUPERVISOR (local elevation via membership.role included), replacing
 * `requireRole(ADMIN, SUPERVISOR)` on the project management routes.
 *
 * Same invariant as above: a project in the trash is not managed. It is restored first, through the
 * dedicated route which does not go through this guard.
 */
export const requireProjectManage = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Non authentifié' });
    return;
  }
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) {
    res.status(400).json({ error: 'projectId invalide' });
    return;
  }
  // Same guard as everywhere else, with the intent on top: a single implementation of the pair
  // "addressable project + effective role", hence a single one to fix.
  const outcome = await resolveProjectAccess(req.user.id, req.user.role, projectId, {
    intent: 'manage',
  });
  next(outcome === 'granted' ? undefined : projectAccessError(outcome, 'manage'));
};
