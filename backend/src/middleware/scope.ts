// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import { hasScope, type Scope } from '../lib/apiScopes';
import { forbidden, unauthorized } from '../lib/errors';

/**
 * Contrôle de scope pour l'API v1 : chaque route déclare le scope qu'elle exige.
 *
 * Une session interactive (JWT) n'a pas de scopes — un utilisateur connecté est déjà
 * borné par son rôle et son appartenance aux projets. Le scope ne s'applique donc qu'aux
 * requêtes portant un token d'API, dont il restreint le pouvoir *en deçà* de celui du
 * porteur : un token ne donne jamais plus que ce que son porteur peut faire.
 */
/** Middleware de scope portant le scope exigé — lu par le générateur OpenAPI. */
export interface ScopeMiddleware {
  (req: Request, res: Response, next: NextFunction): void;
  scope: Scope;
}

export const requireScope = (scope: Scope): ScopeMiddleware => {
  const middleware = (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (req.apiToken && !hasScope(req.apiToken.scopes, scope)) {
      next(forbidden(`Scope « ${scope} » is required`, 'SCOPE_REQUIRED'));
      return;
    }
    next();
  };
  middleware.scope = scope;
  return middleware;
};

/**
 * Vérifie qu'un token cantonné à un projet ne sort pas de ce projet.
 * À appeler dans les handlers dès qu'un projectId est résolu — le cantonnement est le
 * garde-fou qui rend un token de ferme de rendu diffusable sur un seul film.
 */
export function assertTokenProject(req: Request, projectId: number): void {
  const bound = req.apiToken?.projectId;
  if (bound !== undefined && bound !== projectId) {
    throw forbidden('This token is scoped to another project', 'TOKEN_PROJECT_SCOPE');
  }
}
