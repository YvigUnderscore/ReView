// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { signRefreshToken } from './jwt';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  hasRefreshCsrfHeader,
  readCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './refreshCookie';

const req = (over: Partial<Request> = {}) => ({ secure: false, headers: {}, ...over }) as Request;
const res = () =>
  ({ cookie: vi.fn(), clearCookie: vi.fn() }) as unknown as Response & {
    cookie: ReturnType<typeof vi.fn>;
    clearCookie: ReturnType<typeof vi.fn>;
  };

describe('setRefreshCookie', () => {
  it('httpOnly, SameSite=Strict, scoped to the refresh path, expiring with the token', () => {
    const token = signRefreshToken({ id: 1, email: 'a@b.c', role: 'ARTIST', sid: 's' });
    const r = res();
    setRefreshCookie(req(), r, token);
    const [name, value, options] = r.cookie.mock.calls[0]!;
    expect(name).toBe(REFRESH_COOKIE);
    expect(value).toBe(token);
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/auth/refresh',
      secure: false,
    });
    expect(options.expires.getTime()).toBeGreaterThan(Date.now());
  });

  it('is Secure as soon as the request came over HTTPS', () => {
    const r = res();
    setRefreshCookie(req({ secure: true }), r, 'not-a-jwt');
    expect(r.cookie.mock.calls[0]![2]).toMatchObject({ secure: true });
    expect(r.cookie.mock.calls[0]![2]).not.toHaveProperty('expires');
  });
});

describe('clearRefreshCookie', () => {
  it('clears with the same attributes, or the browser would keep it', () => {
    const r = res();
    clearRefreshCookie(req(), r);
    expect(r.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE,
      expect.objectContaining({ path: '/api/auth/refresh' }),
    );
  });
});

describe('cookie and header reading', () => {
  it('reads a named cookie among others, decoded', () => {
    expect(readCookie('a=1; review_refresh=x%2Ey; b=2', REFRESH_COOKIE)).toBe('x.y');
    expect(readCookie(undefined, 'a')).toBeNull();
    expect(readCookie('a=1', 'b')).toBeNull();
    expect(readCookie('a=%E0%A4%A', 'a')).toBeNull();
    expect(readRefreshCookie(req({ headers: { cookie: 'review_refresh=t' } }))).toBe('t');
  });

  it('requires a non-empty X-Requested-With header', () => {
    expect(hasRefreshCsrfHeader(req({ headers: { 'x-requested-with': 'ReView' } }))).toBe(true);
    expect(hasRefreshCsrfHeader(req({ headers: { 'x-requested-with': ' ' } }))).toBe(false);
    expect(hasRefreshCsrfHeader(req())).toBe(false);
  });
});
