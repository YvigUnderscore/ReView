// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import { hasScope, type Scope } from '../lib/apiScopes';
import { isApiTokenFormat } from '../lib/apiTokens';
import { forbidden, unauthorized } from '../lib/errors';

/**
 * Scope check for the v1 API: each route declares the scope it requires.
 *
 * An interactive session (JWT) has no scopes: a logged-in user is already bounded by their role and
 * their project memberships. Scopes therefore only apply to requests carrying an API token, whose
 * power they restrict *below* that of the holder: a token never grants more than its holder can do.
 */
/** Scope middleware carrying the required scopes, read by the OpenAPI generator. */
export interface ScopeMiddleware {
  (req: Request, res: Response, next: NextFunction): void;
  /**
   * First required scope. Kept for readers who only expect one; the full list is in `scopes`, and
   * that is the one to document.
   */
  scope: Scope;
  /** All required scopes, in declaration order. */
  scopes: readonly Scope[];
}

/**
 * Requires one or more scopes. A route that touches two families names both: publishing from a DCC
 * creates a version AND uploads a media, and requiring only `versions:write` would let a token write
 * to storage without having asked for it.
 *
 * The refusal concerns the **first** missing scope, in declared order: the message says what must be
 * added to the token, without revealing the full set of requirements at once.
 */
export const requireScope = (...scopes: [Scope, ...Scope[]]): ScopeMiddleware => {
  const middleware = (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (req.apiToken) {
      const missing = scopes.find((s) => !hasScope(req.apiToken!.scopes, s));
      if (missing !== undefined) {
        next(forbidden(`Scope « ${missing} » is required`, 'SCOPE_REQUIRED'));
        return;
      }
    }
    next();
  };
  middleware.scope = scopes[0];
  middleware.scopes = scopes;
  return middleware;
};

/**
 * Checks that a token confined to a project does not leave that project.
 * To be called in handlers as soon as a projectId is resolved: confinement is the safeguard that makes
 * a render-farm token shareable across a single film.
 */
export function assertTokenProject(req: Request, projectId: number): void {
  const bound = req.apiToken?.projectId;
  if (bound !== undefined && bound !== projectId) {
    throw forbidden('This token is scoped to another project', 'TOKEN_PROJECT_SCOPE');
  }
}

/**
 * ── Surface of an API token: `/api/v1`, and nothing else ────────────────────
 *
 * Project confinement (`assertTokenProject`) and the fine-grained scopes (`requireScope`) are only
 * applied by the v1 routes. The internal `/api` API, however, accepted the same `rvk_…` without ever
 * consulting them: a render-farm token confined to project X read and wrote all projects as soon as it
 * targeted `/api/projects`, `/api/media/:id/url` or `/api/admin/*`. The guarantee sold with
 * confinement was therefore false outside v1.
 *
 * We make it true at the one place that cannot be forgotten: a middleware mounted on `/api`, BEFORE
 * the routers. An API token now only opens the stable contract intended for it; the internal API
 * remains reserved to human sessions (JWT), which are bounded by their role and their project
 * memberships.
 *
 * Accepted consequences: a script calling `/api/...` with a `rvk_` gets an explicit 403
 * (`API_TOKEN_V1_ONLY`) rather than an overly broad access. The v1 equivalents exist (`/api/v1/me`,
 * `/api/v1/schema`, `/api/v1/media/:id/url`).
 *
 * ⚠ The middleware reads the `Authorization` header itself: it runs before `authenticate`, so
 * `req.apiToken` is not set yet. It validates nothing (a wrong or revoked token will be refused
 * further on): it only orients the surface.
 */
export const V1_SURFACE_PREFIX = '/api/v1';

/**
 * Served identically with or without a token (no data, only the shape of the API): refusing them
 * would protect nothing and would break the discovery of an instance.
 */
const PUBLIC_SURFACE = new Set(['/api/docs', '/api/openapi.json']);

const BEARER_SCHEME = /^Bearer[ ]+(.+)$/i;

/**
 * Path of the request, as Express routed it.
 *
 * We start from `originalUrl` (the middleware is mounted on `/api`, so `req.path` would be stripped of
 * the mount point), remove the query, and tolerate the absolute form (`GET http://host/api/…`, legal in
 * HTTP/1.1). Any unrecognized form falls back to refusal: the guard is closed by default.
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
    // Invalid escape: we keep the raw form, which will match nothing allowed.
  }
  // Express routes `/api/docs/` the same as `/api/docs`: the trailing slash must not decide.
  const trimmed = decoded.length > 1 ? decoded.replace(/\/+$/, '') : decoded;
  return (trimmed || '/').toLowerCase();
}

/** Does the path target the v1 API? A `..` segment disqualifies it outright. */
function targetsV1(pathname: string): boolean {
  if (pathname.split('/').includes('..')) return false;
  return pathname === V1_SURFACE_PREFIX || pathname.startsWith(`${V1_SURFACE_PREFIX}/`);
}

/** Refuses an API token everywhere other than `/api/v1`. To be mounted on `/api`. */
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
