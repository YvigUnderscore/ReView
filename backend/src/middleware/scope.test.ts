// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';
import { requireScope, assertTokenProject, apiTokenSurface, V1_SURFACE_PREFIX } from './scope';

/**
 * Contrôle de scope, cantonnement projet et — surtout — surface d'un token d'API.
 *
 * Le troisième bloc couvre le trou relevé par l'audit : le cantonnement projet et les
 * scopes fins ne vivaient que sur `/api/v1`, si bien qu'un `rvk_…` visant `/api/...`
 * retrouvait tout le pouvoir de son porteur, sur tous les projets.
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
  it('refuse une requête non authentifiée (401)', () => {
    const err = run(requireScope('media:read'), requestOf({}));
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(401);
  });

  it('laisse passer une session JWT : un humain est borné par son rôle, pas par des scopes', () => {
    expect(run(requireScope('media:read'), requestOf({ user: sessionUser }))).toBeUndefined();
  });

  it('refuse un token qui ne porte pas le scope exigé', () => {
    const err = run(
      requireScope('versions:write'),
      requestOf({ user: sessionUser, apiToken: { id: 1, scopes: ['media:read'], kind: 'SERVICE' } }),
    );
    expect((err as AppError).statusCode).toBe(403);
    expect((err as AppError).code).toBe('SCOPE_REQUIRED');
  });

  it('accepte le scope exact comme le scope admin', () => {
    const exact = requestOf({ user: sessionUser, apiToken: { id: 1, scopes: ['versions:write'] } });
    const admin = requestOf({ user: sessionUser, apiToken: { id: 1, scopes: ['admin'] } });
    expect(run(requireScope('versions:write'), exact)).toBeUndefined();
    expect(run(requireScope('versions:write'), admin)).toBeUndefined();
  });

  it('expose le scope exigé, que lit le générateur OpenAPI', () => {
    expect(requireScope('media:read').scope).toBe('media:read');
    expect(requireScope('media:read').scopes).toEqual(['media:read']);
  });

  /**
   * Publication depuis un DCC : une version ET un média. Un token qui ne porte que l'un
   * des deux doit être refusé, et le message doit nommer celui qui manque.
   */
  it('exige tous les scopes déclarés, et refuse sur le premier manquant', () => {
    const partial = requestOf({ user: sessionUser, apiToken: { id: 1, scopes: ['versions:write'] } });
    const err = run(requireScope('versions:write', 'media:write'), partial);
    expect((err as AppError).statusCode).toBe(403);
    expect((err as AppError).message).toContain('media:write');

    const reversed = run(requireScope('media:write', 'versions:write'), partial);
    expect((reversed as AppError).message).toContain('media:write');
  });

  it('accepte un token qui porte les deux scopes, ou le write hérité', () => {
    const both = requestOf({
      user: sessionUser,
      apiToken: { id: 1, scopes: ['versions:write', 'media:write'] },
    });
    const legacy = requestOf({ user: sessionUser, apiToken: { id: 1, scopes: ['write'] } });
    expect(run(requireScope('versions:write', 'media:write'), both)).toBeUndefined();
    expect(run(requireScope('versions:write', 'media:write'), legacy)).toBeUndefined();
  });

  it('expose la liste complète des scopes exigés', () => {
    expect(requireScope('versions:write', 'media:write').scopes).toEqual(['versions:write', 'media:write']);
  });
});

describe('assertTokenProject', () => {
  it('ne dit rien d’une session ou d’un token non cantonné', () => {
    expect(() => assertTokenProject(requestOf({ user: sessionUser }), 3)).not.toThrow();
    expect(() =>
      assertTokenProject(requestOf({ user: sessionUser, apiToken: { id: 1, scopes: [] } }), 3),
    ).not.toThrow();
  });

  it('refuse un projet autre que celui du token', () => {
    const req = requestOf({ user: sessionUser, apiToken: { id: 1, scopes: [], projectId: 3 } });
    expect(() => assertTokenProject(req, 3)).not.toThrow();
    expect(() => assertTokenProject(req, 4)).toThrow(/scoped to another project/);
  });
});

describe('apiTokenSurface — un token d’API n’ouvre que /api/v1', () => {
  const withToken = (path: string) => requestOf({ path, authorization: 'Bearer rvk_' + 'a'.repeat(40) });

  it('laisse passer une session JWT sur l’API interne', () => {
    const req = requestOf({ path: '/api/media/12/url', authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y' });
    expect(run(apiTokenSurface, req)).toBeUndefined();
  });

  it('laisse passer une requête anonyme (partage client, connexion)', () => {
    expect(run(apiTokenSurface, requestOf({ path: '/api/client/abc' }))).toBeUndefined();
  });

  it('refuse un token d’API sur l’API interne', () => {
    const err = run(apiTokenSurface, withToken('/api/media/12/url'));
    expect((err as AppError).statusCode).toBe(403);
    expect((err as AppError).code).toBe('API_TOKEN_V1_ONLY');
  });

  it('refuse un token d’API sur l’administration du studio', () => {
    expect((run(apiTokenSurface, withToken('/api/admin/service-tokens')) as AppError).code).toBe(
      'API_TOKEN_V1_ONLY',
    );
  });

  it('accepte l’API v1, son index comme ses sous-routes', () => {
    expect(run(apiTokenSurface, withToken(V1_SURFACE_PREFIX))).toBeUndefined();
    expect(run(apiTokenSurface, withToken('/api/v1/publish'))).toBeUndefined();
    expect(run(apiTokenSurface, withToken('/api/v1/events?since=42'))).toBeUndefined();
  });

  // Express monte ses routeurs sans distinguer la casse : refuser ici rejetterait une
  // requête que le routage, lui, aurait bien conduite jusqu'à v1.
  it('ignore la casse du chemin, comme le routage', () => {
    expect(run(apiTokenSurface, withToken('/API/V1/publish'))).toBeUndefined();
  });

  it('ne se laisse pas prendre à un préfixe qui ressemble à v1', () => {
    expect((run(apiTokenSurface, withToken('/api/v1x/media/12')) as AppError).code).toBe('API_TOKEN_V1_ONLY');
    expect((run(apiTokenSurface, withToken('/api/v10/media/12')) as AppError).code).toBe('API_TOKEN_V1_ONLY');
  });

  it('refuse une remontée de chemin qui prétend partir de v1', () => {
    expect((run(apiTokenSurface, withToken('/api/v1/../media/12/url')) as AppError).code).toBe(
      'API_TOKEN_V1_ONLY',
    );
    expect((run(apiTokenSurface, withToken('/api/v1/%2e%2e/media/12/url')) as AppError).code).toBe(
      'API_TOKEN_V1_ONLY',
    );
  });

  it('accepte la forme absolue de la ligne de requête, licite en HTTP/1.1', () => {
    expect(run(apiTokenSurface, withToken('http://review.studio/api/v1/me'))).toBeUndefined();
    expect((run(apiTokenSurface, withToken('http://review.studio/api/projects')) as AppError).code).toBe(
      'API_TOKEN_V1_ONLY',
    );
  });

  it('laisse la documentation publique, servie à l’identique avec ou sans jeton', () => {
    expect(run(apiTokenSurface, withToken('/api/docs'))).toBeUndefined();
    expect(run(apiTokenSurface, withToken('/api/docs/'))).toBeUndefined();
    expect(run(apiTokenSurface, withToken('/api/openapi.json'))).toBeUndefined();
  });

  it('ne laisse pas une barre finale changer la décision', () => {
    expect(run(apiTokenSurface, withToken('/api/v1/'))).toBeUndefined();
    expect((run(apiTokenSurface, withToken('/api/projects/')) as AppError).code).toBe('API_TOKEN_V1_ONLY');
  });

  // Le middleware court avant `authenticate`, mais doit rester juste s'il est monté après :
  // le jeton est alors connu par `req.apiToken` et non plus par l'en-tête.
  it('refuse aussi quand le token est déjà résolu sur la requête', () => {
    const req = requestOf({ path: '/api/projects', apiToken: { id: 1, scopes: ['read'] } });
    expect((run(apiTokenSurface, req) as AppError).code).toBe('API_TOKEN_V1_ONLY');
  });
});
