// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import { hasScope, type Scope } from '../lib/apiScopes';
import { isApiTokenFormat } from '../lib/apiTokens';
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

/**
 * ── Surface d'un token d'API : `/api/v1`, et rien d'autre ────────────────────
 *
 * Le cantonnement projet (`assertTokenProject`) et les scopes fins (`requireScope`) ne
 * sont posés que par les routes v1. L'API interne `/api`, elle, acceptait le même
 * `rvk_…` sans jamais les consulter : un token de ferme de rendu cantonné au projet X
 * lisait et écrivait tous les projets dès qu'il visait `/api/projects`,
 * `/api/media/:id/url` ou `/api/admin/*`. La garantie vendue par le cantonnement était
 * donc fausse hors de v1.
 *
 * On la rend vraie au seul endroit qui ne s'oublie pas : un middleware monté sur `/api`,
 * AVANT les routeurs. Un token d'API n'ouvre plus que le contrat stable qui lui est
 * destiné ; l'API interne reste réservée aux sessions humaines (JWT), qui sont bornées
 * par leur rôle et leur appartenance aux projets.
 *
 * Conséquences assumées : un script qui appelait `/api/...` avec un `rvk_` reçoit un 403
 * explicite (`API_TOKEN_V1_ONLY`) plutôt qu'un accès trop large. Les équivalents v1
 * existent (`/api/v1/me`, `/api/v1/schema`, `/api/v1/media/:id/url`).
 *
 * ⚠ Le middleware lit l'en-tête `Authorization` lui-même : il court avant
 * `authenticate`, donc `req.apiToken` n'est pas encore posé. Il ne valide rien — un
 * jeton faux ou révoqué sera refusé plus loin — il ne fait qu'orienter la surface.
 */
export const V1_SURFACE_PREFIX = '/api/v1';

/**
 * Servis à l'identique avec ou sans jeton (aucune donnée, seulement la forme de l'API) :
 * les refuser ne protégerait rien et casserait la découverte d'une instance.
 */
const PUBLIC_SURFACE = new Set(['/api/docs', '/api/openapi.json']);

const BEARER_SCHEME = /^Bearer[ ]+(.+)$/i;

/**
 * Chemin de la requête, tel qu'Express l'a routé.
 *
 * On repart de `originalUrl` (le middleware est monté sur `/api`, `req.path` serait
 * amputé du point de montage), on retire la query, et on tolère la forme absolue
 * (`GET http://host/api/…`, licite en HTTP/1.1). Toute forme non reconnue retombe sur le
 * refus : la garde est fermée par défaut.
 */
function requestPathname(req: Request): string {
  const target = (req.originalUrl || req.url) ?? '';
  const withoutQuery = target.split('?')[0] ?? '';
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.exec(withoutQuery);
  const pathname = absolute ? withoutQuery.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '') : withoutQuery;
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Échappement invalide : on garde la forme brute, qui ne correspondra à rien d'autorisé.
  }
  // Express route `/api/docs/` comme `/api/docs` : la barre finale ne doit pas décider.
  const trimmed = decoded.length > 1 ? decoded.replace(/\/+$/, '') : decoded;
  return (trimmed || '/').toLowerCase();
}

/** Le chemin vise-t-il l'API v1 ? Un segment `..` disqualifie d'office. */
function targetsV1(pathname: string): boolean {
  if (pathname.split('/').includes('..')) return false;
  return pathname === V1_SURFACE_PREFIX || pathname.startsWith(`${V1_SURFACE_PREFIX}/`);
}

/** Refuse un token d'API partout ailleurs que sur `/api/v1`. À monter sur `/api`. */
export const apiTokenSurface = (req: Request, _res: Response, next: NextFunction): void => {
  const bearer = BEARER_SCHEME.exec(req.headers['authorization'] ?? '')?.[1]?.trim();
  const carriesApiToken = req.apiToken !== undefined || (bearer !== undefined && isApiTokenFormat(bearer));
  if (!carriesApiToken) {
    next();
    return;
  }
  const pathname = requestPathname(req);
  if (targetsV1(pathname) || PUBLIC_SURFACE.has(pathname)) {
    next();
    return;
  }
  next(
    forbidden(
      'API tokens only open the /api/v1 integration API — use a session token for /api',
      'API_TOKEN_V1_ONLY',
    ),
  );
};
