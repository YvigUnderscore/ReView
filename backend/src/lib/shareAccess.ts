// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from 'jsonwebtoken';
import type { ShareLink } from '@prisma/client';
import { env } from '../config/env';
import { JWT_ALGORITHM, JWT_VERIFY_OPTIONS } from './jwt';

/**
 * Client share session (35.C): after the initial `GET /api/client/:token` (which counts the view and applies password/limit), the server issues a short-lived
 * dedicated JWT — required by all public sub-routes. This way the view limit and the password cannot be bypassed by calling the sub-routes directly.
 */

const SHARE_SESSION_TTL = '24h';

export function signShareSession(linkId: number): string {
  return jwt.sign({ kind: 'share', linkId }, env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: SHARE_SESSION_TTL,
  });
}

/** True if `token` is a valid session for this specific link. */
export function verifyShareSession(token: string | undefined, linkId: number): boolean {
  if (!token) return false;
  try {
    // The algorithm is pinned here as in `lib/jwt`: without the `algorithms` option, it is the token's bearer who chooses the algorithm used to verify it. This token opens the
    // client share — password and view limit already passed — so it is verified with exactly the same guarantees as a session token.
    const payload = jwt.verify(token, env.JWT_SECRET, JWT_VERIFY_OPTIONS) as {
      kind?: string;
      linkId?: number;
    };
    return payload.kind === 'share' && payload.linkId === linkId;
  } catch {
    return false;
  }
}

export type ShareState = 'ok' | 'revoked' | 'expired' | 'exhausted';

/** State of a link (pure, testable) — `exhausted` = view limit reached. */
export function shareState(
  link: Pick<ShareLink, 'revoked' | 'expiresAt' | 'maxViews' | 'viewCount'>,
  now = new Date(),
): ShareState {
  if (link.revoked) return 'revoked';
  if (link.expiresAt && link.expiresAt < now) return 'expired';
  if (link.maxViews != null && link.viewCount >= link.maxViews) return 'exhausted';
  return 'ok';
}
