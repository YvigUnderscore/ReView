// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';
import { requireScope, assertTokenProject, apiTokenSurface, V1_SURFACE_PREFIX } from './scope';

/**
 * Scope check, project confinement and, above all, the surface of an API token.
 *
 * The third block covers the gap found by the audit: project confinement and the fine-grained scopes
 * lived only on `/api/v1`, so a `rvk_…` aimed at `/api/...` regained all the power of its holder, on
 * every project.
 */

type ApiToken = NonNullable<Request['apiToken']>;

const requestOf = (init: {
  path?: string;
  authorization?: string;
  apiToken?: Partial<ApiToken>;
  user?: Request['user'];
}): Request =>
  ({
    originalUrl: init.path ?? '/api/v1/me',
    url: init.path ?? '/api/v1/me',
    headers: init.authorization ? { authorization: init.authorization } : {},
    user: init.user,
    apiToken: init.apiToken as ApiToken | undefined,
  }) as unknown as Request;

const run = (middleware: (req: Request, res: Response, next: NextFunction) => void, req: Request) => {
  const next = vi.fn();
  middleware(req, {} as Response, next);
  return next.mock.calls[0]?.[0] as unknown;
};

const sessionUser = { id: 7, email: 'artist@studio.com', role: 'ARTIST' } as Request['user'];

describe('requireScope', () => {
  it('refuses an unauthenticated request (401)', () => {
    const err = run(requireScope('media:read'), requestOf({}));
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(401);
  });

  it('lets a JWT session through: a human is bounded by their role, not by scopes', () => {
    expect(run(requireScope('media:read'), requestOf({ user: sessionUser }))).toBeUndefined();
  });

  it('refuses a token that does not carry the required scope', () => {
    const err = run(
      requireScope('versions:write'),
      requestOf({ user: sessionUser, apiToken: { id: 1, scopes: ['media:read'], kind: 'SERVICE' } }),
    );
    expect((err as AppError).statusCode).toBe(403);
    expect((err as AppError).code).toBe('SCOPE_REQUIRED');
  });

  it('accepts the exact scope as well as the admin scope', () => {
    const exact = requestOf({ user: sessionUser, apiToken: { id: 1, scopes: ['versions:write'] } });
    const admin = requestOf({ user: sessionUser, apiToken: { id: 1, scopes: ['admin'] } });
    expect(run(requireScope('versions:write'), exact)).toBeUndefined();
    expect(run(requireScope('versions:write'), admin)).toBeUndefined();
  });

  it('exposes the required scope, as read by the OpenAPI generator', () => {
    expect(requireScope('media:read').scope).toBe('media:read');
    expect(requireScope('media:read').scopes).toEqual(['media:read']);
  });

  /**
   * Publishing from a DCC: a version AND a media. A token carrying only one of the two must be refused,
   * and the message must name the one that is missing.
   */
  it('requires all declared scopes, and refuses on the first missing one', () => {
    const partial = requestOf({ user: sessionUser, apiToken: { id: 1, scopes: ['versions:write'] } });
    const err = run(requireScope('versions:write', 'media:write'), partial);
    expect((err as AppError).statusCode).toBe(403);
    expect((err as AppError).message).toContain('media:write');

    const reversed = run(requireScope('media:write', 'versions:write'), partial);
    expect((reversed as AppError).message).toContain('media:write');
  });

  it('accepts a token carrying both scopes, or the legacy write scope', () => {
    const both = requestOf({
      user: sessionUser,
      apiToken: { id: 1, scopes: ['versions:write', 'media:write'] },
    });
    const legacy = requestOf({ user: sessionUser, apiToken: { id: 1, scopes: ['write'] } });
    expect(run(requireScope('versions:write', 'media:write'), both)).toBeUndefined();
    expect(run(requireScope('versions:write', 'media:write'), legacy)).toBeUndefined();
  });

  it('exposes the full list of required scopes', () => {
    expect(requireScope('versions:write', 'media:write').scopes).toEqual(['versions:write', 'media:write']);
  });
});

describe('assertTokenProject', () => {
  it('says nothing about a session or an unconfined token', () => {
    expect(() => assertTokenProject(requestOf({ user: sessionUser }), 3)).not.toThrow();
    expect(() =>
      assertTokenProject(requestOf({ user: sessionUser, apiToken: { id: 1, scopes: [] } }), 3),
    ).not.toThrow();
  });

  it("refuses a project other than the token's", () => {
    const req = requestOf({ user: sessionUser, apiToken: { id: 1, scopes: [], projectId: 3 } });
    expect(() => assertTokenProject(req, 3)).not.toThrow();
    expect(() => assertTokenProject(req, 4)).toThrow(/scoped to another project/);
  });
});

describe('apiTokenSurface — an API token only opens /api/v1', () => {
  const withToken = (path: string) => requestOf({ path, authorization: 'Bearer rvk_' + 'a'.repeat(40) });

  it('lets a JWT session through on the internal API', () => {
    const req = requestOf({ path: '/api/media/12/url', authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y' });
    expect(run(apiTokenSurface, req)).toBeUndefined();
  });

  it('lets an anonymous request through (client share, login)', () => {
    expect(run(apiTokenSurface, requestOf({ path: '/api/client/abc' }))).toBeUndefined();
  });

  it('refuses an API token on the internal API', () => {
    const err = run(apiTokenSurface, withToken('/api/media/12/url'));
    expect((err as AppError).statusCode).toBe(403);
    expect((err as AppError).code).toBe('API_TOKEN_V1_ONLY');
  });

  it('refuses an API token on the studio administration', () => {
    expect((run(apiTokenSurface, withToken('/api/admin/service-tokens')) as AppError).code).toBe(
      'API_TOKEN_V1_ONLY',
    );
  });

  it('accepts the v1 API, its index as well as its sub-routes', () => {
    expect(run(apiTokenSurface, withToken(V1_SURFACE_PREFIX))).toBeUndefined();
    expect(run(apiTokenSurface, withToken('/api/v1/publish'))).toBeUndefined();
    expect(run(apiTokenSurface, withToken('/api/v1/events?since=42'))).toBeUndefined();
  });

  // Express mounts its routers without distinguishing case: refusing here would reject a request that
  // routing would have happily carried through to v1.
  it('ignores path case, like routing does', () => {
    expect(run(apiTokenSurface, withToken('/API/V1/publish'))).toBeUndefined();
  });

  it('is not fooled by a prefix that looks like v1', () => {
    expect((run(apiTokenSurface, withToken('/api/v1x/media/12')) as AppError).code).toBe('API_TOKEN_V1_ONLY');
    expect((run(apiTokenSurface, withToken('/api/v10/media/12')) as AppError).code).toBe('API_TOKEN_V1_ONLY');
  });

  it('refuses a path traversal that claims to start from v1', () => {
    expect((run(apiTokenSurface, withToken('/api/v1/../media/12/url')) as AppError).code).toBe(
      'API_TOKEN_V1_ONLY',
    );
    expect((run(apiTokenSurface, withToken('/api/v1/%2e%2e/media/12/url')) as AppError).code).toBe(
      'API_TOKEN_V1_ONLY',
    );
  });

  it('accepts the absolute form of the request line, legal in HTTP/1.1', () => {
    expect(run(apiTokenSurface, withToken('http://review.studio/api/v1/me'))).toBeUndefined();
    expect((run(apiTokenSurface, withToken('http://review.studio/api/projects')) as AppError).code).toBe(
      'API_TOKEN_V1_ONLY',
    );
  });

  it('lets the public documentation through, served identically with or without a token', () => {
    expect(run(apiTokenSurface, withToken('/api/docs'))).toBeUndefined();
    expect(run(apiTokenSurface, withToken('/api/docs/'))).toBeUndefined();
    expect(run(apiTokenSurface, withToken('/api/openapi.json'))).toBeUndefined();
  });

  it('does not let a trailing slash change the decision', () => {
    expect(run(apiTokenSurface, withToken('/api/v1/'))).toBeUndefined();
    expect((run(apiTokenSurface, withToken('/api/projects/')) as AppError).code).toBe('API_TOKEN_V1_ONLY');
  });

  // The middleware runs before `authenticate`, but must remain correct if it is mounted after: the token
  // is then known via `req.apiToken` rather than via the header.
  it('also refuses when the token is already resolved on the request', () => {
    const req = requestOf({ path: '/api/projects', apiToken: { id: 1, scopes: ['read'] } });
    expect((run(apiTokenSurface, req) as AppError).code).toBe('API_TOKEN_V1_ONLY');
  });
});
