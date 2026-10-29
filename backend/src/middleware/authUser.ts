// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from 'express';
import { unauthorized } from '../lib/errors';

// Kept apart from `auth.ts` (which pulls the JWT, session and user-cache stack): route tests mock
// `authenticate` wholesale, and the narrowing must stay the real one under those mocks.

/** Identity set on the request by `authenticate` (JWT session or API token). */
export type AuthUser = NonNullable<Request['user']>;

/** A request that went through `authenticate`: its user is known. */
export type AuthedRequest = Request & { user: AuthUser };

/**
 * The authenticated user of a request, narrowed — replaces the `req.user!` assertions, which would
 * turn a route mounted without `authenticate` into a `TypeError` on `undefined.id` (a 500), into an
 * explicit 401 instead.
 */
export function requireUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Type guard flavour of `requireUser`, for code that branches rather than throws. */
export function isAuthed(req: Request): req is AuthedRequest {
  return req.user !== undefined;
}
