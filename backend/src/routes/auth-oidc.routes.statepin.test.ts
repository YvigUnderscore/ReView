// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The OIDC issuer is an administration URL that the server fetches itself, from the application
 * network: until now `openid-client` followed it without any control. These tests verify that the
 * library does receive our hardened `fetch`, and that the latter refuses an internal target.
 */
const { CUSTOM_FETCH, discoveryMock, buildUrlMock, oidcCfg } = vi.hoisted(() => ({
  CUSTOM_FETCH: Symbol.for('openid-client.customFetch'),
  discoveryMock: vi.fn(),
  buildUrlMock: vi.fn(() => new URL('https://accounts.exemple.com/authorize?x=1')),
  oidcCfg: {
    current: {
      issuer: 'https://accounts.exemple.com',
      clientId: 'client',
      clientSecret: 'secret',
      publicUrl: 'https://review.exemple.com',
      buttonLabel: 'SSO',
      logoKey: null,
      autoProvision: false,
      passwordLoginDisabled: false,
    },
  },
}));

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('openid-client', () => ({
  customFetch: CUSTOM_FETCH,
  discovery: discoveryMock,
  buildAuthorizationUrl: buildUrlMock,
  authorizationCodeGrant: vi.fn(),
}));
vi.mock('../lib/oidcConfig', () => ({
  getOidcConfig: vi.fn(async () => oidcCfg.current),
  getOidcLogoUrl: vi.fn(async () => null),
  isOidcReady: vi.fn(() => true),
}));
vi.mock('../lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn(), create: vi.fn() } } }));
vi.mock('../lib/sessions', () => ({ createSession: vi.fn(async () => 'sid') }));
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(async () => 'hash') } }));
vi.mock('../services/AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import express from 'express';
import request from 'supertest';
import { lookup } from 'node:dns/promises';
import jwt from 'jsonwebtoken';
import * as oidc from 'openid-client';
import oidcRoutes from './auth-oidc.routes';
import { errorHandler } from '../middleware/error';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/sessions';
import { env } from '../config/env';

const app = express().use(express.json()).use('/api/auth/oidc', oidcRoutes).use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
});

/**
 * A3-07 / A1-08: the `oidc_state` cookie carries the state and the nonce, that is, the whole CSRF
 * protection of the login flow, and it is signed with the same `JWT_SECRET` as the session tokens.
 * Its verification read the algorithm from the token header: the party PRESENTING the cookie therefore
 * chose how it had been signed, and the list of accepted algorithms depended on the jsonwebtoken
 * version rather than on us.
 */
describe('GET /api/auth/oidc/callback — state cookie algorithm pinned', () => {
  const callback = (algorithm: 'HS256' | 'HS512') => {
    discoveryMock.mockResolvedValue({});
    vi.mocked(oidc.authorizationCodeGrant).mockResolvedValue({
      claims: () => ({ email: 'sso@studio.com', email_verified: true }),
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 9,
      email: 'sso@studio.com',
      role: 'ARTIST',
      totpEnabledAt: null,
      disabledAt: null,
    } as never);
    const cookie = jwt.sign({ kind: 'oidc', state: 's1', nonce: 'n1' }, env.JWT_SECRET, { algorithm });
    return request(app)
      .get('/api/auth/oidc/callback?code=abc&state=s1')
      .set('Cookie', `oidc_state=${cookie}`);
  };

  it('accepts the cookie signed with the declared algorithm', async () => {
    expect((await callback('HS256')).headers.location).toContain('#sso=');
  });

  it('rejects a cookie signed with ANOTHER algorithm from the same secret', async () => {
    const res = await callback('HS512');
    expect(res.headers.location).toContain('#ssoerr=');
    expect(res.headers.location).not.toContain('#sso=');
    expect(createSession).not.toHaveBeenCalled();
  });

  // Non-regression lock (green before as well as after): issuance follows the algorithm declared by
  // `lib/jwt` instead of relying on the library's default.
  it('issues the cookie with the declared algorithm', async () => {
    discoveryMock.mockResolvedValue({});
    const res = await request(app).get('/api/auth/oidc/login');
    const raw = (res.headers['set-cookie'] as unknown as string[])[0]!;
    const token = decodeURIComponent(raw.split(';')[0]!.split('=').slice(1).join('='));
    const header = (jwt.decode(token, { complete: true }) as { header: { alg: string } }).header;
    expect(header.alg).toBe('HS256');
  });
});
