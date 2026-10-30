// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

/**
 * The refresh token lives in a cookie the page cannot read.
 *
 * It used to be returned in the JSON body and kept in `localStorage`, next to the access token: one XSS — or
 * one compromised script from a CDN — walked away with a thirty-day credential. Now:
 *
 * - **httpOnly**: no script reads it, the browser alone presents it;
 * - **SameSite=Strict**: never sent on a cross-site request, so a third-party page cannot spend it (CSRF);
 * - **path-scoped** to `/api/auth/refresh`: it travels on that one call, not on every API request;
 * - **Secure** in production and whenever the request came over HTTPS (directly or through a trusted
 *   proxy). Plain `http://localhost` in development keeps working.
 *
 * The access token stays in the page's memory only (frontend `apiClient`): a reload restores it through
 * `/api/auth/refresh`. As defence in depth on top of SameSite, the refresh call must also carry the
 * `X-Requested-With` header (`requireRefreshCsrfHeader`), which a cross-site form cannot send.
 */
export const REFRESH_COOKIE = 'review_refresh';
export const REFRESH_COOKIE_PATH = '/api/auth/refresh';
/** Header the refresh call must carry. Any value; the frontend sends `ReView`. */
export const REFRESH_CSRF_HEADER = 'x-requested-with';

function baseOptions(req: Request): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production' || req.secure,
    path: REFRESH_COOKIE_PATH,
  };
}

/** Sets (or rotates) the refresh cookie; it expires with the token it carries. */
export function setRefreshCookie(req: Request, res: Response, refreshToken: string): void {
  const exp = (jwt.decode(refreshToken) as { exp?: number } | null)?.exp;
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseOptions(req),
    ...(exp ? { expires: new Date(exp * 1000) } : {}),
  });
}

/** Removes the refresh cookie (logout, refused refresh). Same attributes, or the browser keeps it. */
export function clearRefreshCookie(req: Request, res: Response): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions(req));
}

/** Reads a cookie without a dependency (there is no cookie-parser in the app). */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The refresh token presented by the browser, if any. */
export function readRefreshCookie(req: Request): string | null {
  return readCookie(req.headers.cookie, REFRESH_COOKIE);
}

/** Cross-site forms cannot set a custom header: its presence proves a same-origin script made the call. */
export function hasRefreshCsrfHeader(req: Request): boolean {
  const value = req.headers[REFRESH_CSRF_HEADER];
  return typeof value === 'string' && value.trim().length > 0;
}
