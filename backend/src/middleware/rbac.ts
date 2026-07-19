import type { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { forbidden, unauthorized } from '../lib/errors';
import { effectiveProjectRole, canManageProject } from '../lib/projectRoles';

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
      res.status(403).json({ error: 'Accès refusé : privilèges insuffisants' });
      return;
    }
    next();
  };

/**
 * Vérifie qu'un utilisateur a accès à un projet.
 * Règles v2 : ADMIN et SUPERVISOR ont un accès global ; les autres via ProjectMembership.
 */
export const checkProjectAccess = async (userId: number, role: Role, projectId: number): Promise<boolean> => {
  if (role === Role.ADMIN || role === Role.SUPERVISOR) return true;
  const membership = await prisma.projectMembership.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  return membership !== null;
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
  const ok = await checkProjectAccess(req.user.id, req.user.role, projectId);
  if (!ok) {
    res.status(403).json({ error: 'Accès au projet refusé' });
    return;
  }
  next();
};

/**
 * Variante utilisable dans un handler : lève une AppError (captée par le handler global)
 * si l'utilisateur n'a pas accès au projet. `req.user` est supposé présent (après authenticate).
 */
export const assertProjectAccess = async (req: Request, projectId: number): Promise<void> => {
  if (!req.user) throw unauthorized();
  if (!(await checkProjectAccess(req.user.id, req.user.role, projectId))) {
    throw forbidden('Accès au projet refusé');
  }
};

/**
 * Gestion projet (38.E) — lit `req.params.projectId` et autorise si le rôle EFFECTIF de
 * l'utilisateur sur ce projet est ADMIN/SUPERVISOR (élévation locale via membership.role
 * incluse), remplaçant `requireRole(ADMIN, SUPERVISOR)` sur les routes de gestion projet.
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
  const role = await effectiveProjectRole(req.user.id, req.user.role, projectId);
  if (!canManageProject(role)) {
    res.status(403).json({ error: 'Gestion du projet réservée aux superviseurs' });
    return;
  }
  next();
};
