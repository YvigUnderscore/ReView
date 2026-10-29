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
import { OutboundBlockedError } from '../lib/safeFetch';
import { prisma } from '../lib/prisma';
import { createSession } from '../lib/sessions';
import { env } from '../config/env';

const app = express().use(express.json()).use('/api/auth/oidc', oidcRoutes).use(errorHandler);

type GuardedFetch = (url: string, options: RequestInit) => Promise<Response>;

/** The `fetch` handed to openid-client during discovery. */
async function capturedFetch(issuer: string): Promise<GuardedFetch> {
  const config: Record<symbol, unknown> = {};
  discoveryMock.mockResolvedValue(config);
  oidcCfg.current = { ...oidcCfg.current, issuer };
  await request(app).get('/api/auth/oidc/login');
  const options = discoveryMock.mock.calls.at(-1)?.[4] as Record<symbol, GuardedFetch>;
  // Discovery receives the option, and the configuration keeps it for the code exchange.
  expect(config[CUSTOM_FETCH]).toBe(options[CUSTOM_FETCH]);
  return options[CUSTOM_FETCH]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
});

describe('SSO OIDC — outbound requests under guard', () => {
  it('hands a hardened fetch to openid-client', async () => {
    const guarded = await capturedFetch('https://accounts.a.exemple.com');
    expect(typeof guarded).toBe('function');
  });

  it('rejects an issuer targeting the metadata service', async () => {
    const guarded = await capturedFetch('https://accounts.b.exemple.com');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      guarded('http://169.254.169.254/.well-known/openid-configuration', { method: 'GET' }),
    ).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('rejects an issuer whose name resolves to an internal address', async () => {
    const guarded = await capturedFetch('https://accounts.c.exemple.com');
    vi.mocked(lookup).mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);
    await expect(guarded('https://sso.interne.exemple/token', { method: 'POST' })).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
  });

  it('sends to a public provider, never following a redirect blindly', async () => {
    const guarded = await capturedFetch('https://accounts.d.exemple.com');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await guarded('https://accounts.google.com/.well-known/openid-configuration', {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).redirect).toBe('manual');
    vi.unstubAllGlobals();
  });
});

/**
 * A1-01: the widest gate of all. With SSO, the identity lives with the provider and outlives the
 * departure. Without a guard, the callback handed the leaver, even without a password, the access
 * that the deactivation had just withdrawn from them.
 */
describe('GET /api/auth/oidc/callback — deactivated account', () => {
  /** State cookie: the callback requires the state and nonce that it set itself. */
  const stateCookie = () =>
    `oidc_state=${jwt.sign({ kind: 'oidc', state: 's1', nonce: 'n1' }, env.JWT_SECRET)}`;

  const callback = async (disabledAt: Date | null) => {
    discoveryMock.mockResolvedValue({});
    vi.mocked(oidc.authorizationCodeGrant).mockResolvedValue({
      claims: () => ({ email: 'partie@studio.com', email_verified: true }),
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 7,
      email: 'partie@studio.com',
      role: 'ARTIST',
      totpEnabledAt: null,
      disabledAt,
    } as never);
    return request(app).get('/api/auth/oidc/callback?code=abc&state=s1').set('Cookie', stateCookie());
  };

  it('issues no token for a deactivated account', async () => {
    const res = await callback(new Date());
    expect(res.headers.location).toContain('#ssoerr=');
    expect(res.headers.location).not.toContain('#sso=');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('logs in an active account normally', async () => {
    const res = await callback(null);
    expect(res.headers.location).toContain('#sso=');
    expect(createSession).toHaveBeenCalled();
  });

  it('puts no token in the redirect URL: the refresh token goes into its httpOnly cookie', async () => {
    const res = await callback(null);
    expect(res.headers.location).toBe('/login#sso=cookie');
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const refresh = cookies.find((c) => c.startsWith('review_refresh='));
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/SameSite=Strict/i);
    expect(refresh).toMatch(/Path=\/api\/auth\/refresh/);
  });
});
