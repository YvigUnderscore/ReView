// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type NextFunction, type Request, type Response } from 'express';
import { forbidden } from '../lib/errors';
import {
  clearRefreshCookie,
  hasRefreshCsrfHeader,
  readRefreshCookie,
  setRefreshCookie,
} from '../lib/refreshCookie';
import { endSession, renewSession } from '../services/AuthSessionService';

/**
 * `/api/auth/refresh`: the only path the refresh cookie is sent to (`lib/refreshCookie`), hence the two
 * operations that need it live here.
 *
 * Both require the `X-Requested-With` header on top of SameSite=Strict: a cross-site form cannot set it.
 */
const router = Router();

function requireCsrfHeader(req: Request, _res: Response, next: NextFunction): void {
  if (!hasRefreshCsrfHeader(req)) throw forbidden('Missing X-Requested-With header', 'CSRF_HEADER_REQUIRED');
  next();
}

router.use(requireCsrfHeader);

// POST /api/auth/refresh — new access token, rotated refresh cookie. Any refusal clears the cookie.
router.post('/', async (req, res) => {
  try {
    const tokens = await renewSession(readRefreshCookie(req));
    setRefreshCookie(req, res, tokens.refreshToken);
    res.json({ token: tokens.accessToken });
  } catch (err) {
    clearRefreshCookie(req, res);
    throw err;
  }
});

// DELETE /api/auth/refresh — logout: revokes the cookie's session and clears it, no access token needed.
router.delete('/', async (req, res) => {
  await endSession(readRefreshCookie(req));
  clearRefreshCookie(req, res);
  res.status(204).end();
});

export default router;
