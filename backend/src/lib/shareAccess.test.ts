// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { signShareSession, verifyShareSession, shareState } from './shareAccess';
import { signAccessToken } from './jwt';
import { env } from '../config/env';

describe('shareAccess', () => {
  it('signs and verifies a session for the right link', () => {
    const token = signShareSession(42);
    expect(verifyShareSession(token, 42)).toBe(true);
  });

  it('refuses a session for another link', () => {
    const token = signShareSession(42);
    expect(verifyShareSession(token, 43)).toBe(false);
  });

  it('refuses an absent or invalid token', () => {
    expect(verifyShareSession(undefined, 1)).toBe(false);
    expect(verifyShareSession('pas-un-jwt', 1)).toBe(false);
  });

  it('refuses an ordinary user JWT (kind ≠ share)', () => {
    // A login access token must not open a share session.
    const userToken = signAccessToken({ id: 1, email: 'a@b.c', role: 'ADMIN', sid: 'sid-test' });
    expect(verifyShareSession(userToken, 1)).toBe(false);
  });

  it('signs with HS256, and refuses any other algorithm at verification', () => {
    // Without the `algorithms` option, jsonwebtoken accepts HS256/384/512: it is then the token's bearer who chooses the algorithm used to verify it. The first
    // assertion notes this latitude; the second pins down the fact that it is not left to the share session, which opens a link already past password and quota.
    const forged = jwt.sign({ kind: 'share', linkId: 42 }, env.JWT_SECRET, { algorithm: 'HS512' });
    expect(jwt.verify(forged, env.JWT_SECRET)).toMatchObject({ kind: 'share', linkId: 42 });
    expect(verifyShareSession(forged, 42)).toBe(false);

    const header = JSON.parse(
      Buffer.from(signShareSession(42).split('.')[0]!, 'base64url').toString('utf8'),
    ) as { alg: string };
    expect(header.alg).toBe('HS256');
  });

  describe('shareState', () => {
    const base = { revoked: false, expiresAt: null, maxViews: null, viewCount: 0 };
    it('ok by default', () => {
      expect(shareState(base)).toBe('ok');
    });
    it('revoked takes precedence', () => {
      expect(shareState({ ...base, revoked: true })).toBe('revoked');
    });
    it('expired if expiresAt has passed', () => {
      expect(shareState({ ...base, expiresAt: new Date(Date.now() - 1000) })).toBe('expired');
      expect(shareState({ ...base, expiresAt: new Date(Date.now() + 60_000) })).toBe('ok');
    });
    it('exhausted if viewCount ≥ maxViews', () => {
      expect(shareState({ ...base, maxViews: 3, viewCount: 3 })).toBe('exhausted');
      expect(shareState({ ...base, maxViews: 3, viewCount: 2 })).toBe('ok');
    });
  });
});
