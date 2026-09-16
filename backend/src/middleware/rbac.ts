// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { forbidden, notFound, unauthorized } from '../lib/errors';
import { effectiveProjectRole, canManageProject, canContribute } from '../lib/projectRoles';

/**
 * Ce que l'appelant vient FAIRE du projet.
 *
 * Racine du défaut 38.E/A1-03 : la garde d'accès n'accordait que sur l'existence du
 * `ProjectMembership` et ignorait son champ `role`. Chaque appelant qui écrivait devait
 * donc *se souvenir* d'ajouter `assertCanContribute` derrière — et trois l'avaient oublié
 * (marqueurs de timeline, gestion de média, board). Une garde qu'il faut penser à doubler
 * n'est pas une garde : c'est une convention.
 *
 * L'intention rend le rôle obligatoire au bon endroit. `read` reste le défaut (un CLIENT
 * membre lit et commente, c'est son métier) ; `write` exige de pouvoir contribuer ;
 * `manage` exige le rôle de gestion. Dans les trois cas c'est le rôle EFFECTIF sur CE
 * projet qui décide (`lib/projectRoles`), élévation et rétrogradation locales comprises.
 */
export type ProjectAccessIntent = 'read' | 'write' | 'manage';

/**
 * Options d'un contrôle d'accès projet.
 *
 * `includeTrashed` est la SEULE dérogation à l'invariant de corbeille, et elle est
 * réservée aux points d'entrée qui parlent explicitement de corbeille : lister les projets
 * retirés, en restaurer un, en purger un. Partout ailleurs l'option reste absente — une
 * exception « si admin » posée au cas par cas rouvrirait la porte que cette garde ferme.
 */
export interface ProjectAccessOptions {
  includeTrashed?: boolean;
  intent?: ProjectAccessIntent;
}

/**
 * Verdict d'un contrôle d'accès projet. Le refus dit sa nature pour que l'appelant
 * choisisse le bon code : 404 quand le projet n'est pas désignable, 403 quand il l'est
 * mais que la personne n'y appartient pas ou que son rôle ne porte pas l'intention.
 */
export type ProjectAccessOutcome = 'granted' | 'not-member' | 'unavailable' | 'insufficient-role';

/**
 * Exige que l'utilisateur authentifié possède l'un des rôles donnés.
 * À utiliser après `authenticate`.
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
 * Le projet est-il désignable ? Il doit exister et, hors point d'entrée « corbeille »,
 * ne pas y avoir été mis.
 */
const projectIsAddressable = async (projectId: number, includeTrashed: boolean): Promise<boolean> =>
  (await prisma.project.count({
    where: { id: projectId, ...(includeTrashed ? {} : { deletedAt: null }) },
  })) > 0;

/**
 * Résout l'accès d'un utilisateur à un projet.
 *
 * **Invariant : un projet mis à la corbeille n'existe plus pour le RBAC.** Les listes le
 * filtraient déjà (`deletedAt: null`), mais la garde d'appartenance ne regardait que le
 * membership : un média, un plan, une séquence ou un asset d'un projet retiré restait
 * atteignable en connaissant son URL, et le retrait se contournait. Le refus est un 404,
 * pas un 403 : un projet retiré ne doit pas se laisser deviner davantage qu'un projet qui
 * n'a jamais existé.
 *
 * Règles v2 inchangées par ailleurs : ADMIN et SUPERVISOR ont un accès global, les autres
 * passent par leur `ProjectMembership`.
 *
 * **Le rôle EFFECTIF est lu ici**, et plus seulement l'existence du membership : c'est ce
 * qui permet à `intent` de trancher sans que l'appelant ait à doubler la garde (38.E).
 * Pour un accès global (ADMIN/SUPERVISOR) `effectiveProjectRole` répond sans interroger le
 * membership — le coût en requêtes est donc inchangé.
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
 * Forme booléenne de `resolveProjectAccess`, pour les appelants qui formulent eux-mêmes
 * le refus (contrôles de lot, résolutions par identifiant).
 */
export const checkProjectAccess = async (
  userId: number,
  role: Role,
  projectId: number,
  options?: ProjectAccessOptions,
): Promise<boolean> => (await resolveProjectAccess(userId, role, projectId, options)) === 'granted';

/**
 * Erreur typée correspondant à un verdict de refus. Le 404 reste générique (message et
 * code de repli) : nommer le projet dans la réponse annulerait le bénéfice du 404.
 *
 * Le refus de RÔLE se distingue du refus d'APPARTENANCE : il porte le code
 * `ROLE_FORBIDDEN` — le même qu'`assertCanContribute` —, sans quoi l'interface dirait
 * « aucun accès à ce projet » à quelqu'un qui le voit parfaitement mais n'y écrit pas.
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
 * Middleware d'accès projet — lit l'id projet depuis `req.params.projectId`.
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
  // Erreur typée plutôt que réponse écrite ici : le handler global uniformise `{error, code}`,
  // seul moyen pour l'interface d'afficher le refus dans la langue du lecteur.
  next(outcome === 'granted' ? undefined : projectAccessError(outcome, 'read'));
};

/**
 * Variante utilisable dans un handler : lève une AppError (captée par le handler global)
 * si l'utilisateur n'a pas accès au projet. `req.user` est supposé présent (après authenticate).
 *
 * Un handler qui ÉCRIT passe `{ intent: 'write' }` : la garde vérifie alors le rôle
 * effectif elle-même, au lieu de compter sur l'appel à `assertCanContribute` que trois
 * chemins d'écriture avaient oublié (A1-03).
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
 * Gestion projet (38.E) — lit `req.params.projectId` et autorise si le rôle EFFECTIF de
 * l'utilisateur sur ce projet est ADMIN/SUPERVISOR (élévation locale via membership.role
 * incluse), remplaçant `requireRole(ADMIN, SUPERVISOR)` sur les routes de gestion projet.
 *
 * Même invariant que ci-dessus : un projet à la corbeille ne se gère pas — on le restaure
 * d'abord, par la route dédiée qui, elle, ne passe pas par cette garde.
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
  // Même garde que partout ailleurs, l'intention en plus : une seule implémentation du
  // couple « projet désignable + rôle effectif », donc une seule à corriger.
  const outcome = await resolveProjectAccess(req.user.id, req.user.role, projectId, {
    intent: 'manage',
  });
  next(outcome === 'granted' ? undefined : projectAccessError(outcome, 'manage'));
};
