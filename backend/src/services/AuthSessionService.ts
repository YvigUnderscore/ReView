// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { signAccessToken, signRefreshToken, verifyToken } from '../lib/jwt';
import { isSessionActive, revokeSession, touchSession } from '../lib/sessions';
import { unauthorized } from '../lib/errors';

/**
 * Renewal of a session from its refresh token: returns a fresh access token and the rotated refresh token.
 *
 * ⚠ A refresh token without `sid` is REFUSED: it does not obtain a fresh session. The "transparent migration"
 * that manufactured one was the back door of the 36.B fix: closing `middleware/auth` is pointless if the
 * legacy token that was just set aside is enough to walk away with a perfectly valid access token.
 */
export async function renewSession(
  refreshToken: string | null,
): Promise<{ accessToken: string; refreshToken: string }> {
  if (!refreshToken) throw unauthorized('No refresh token', 'NO_REFRESH_TOKEN');
  const payload = verifyToken(refreshToken);
  if (!payload || payload.kind !== 'refresh') throw unauthorized('Invalid refresh token');
  const { sid } = payload;
  if (!sid) throw unauthorized('Session revoked', 'SESSION_REVOKED');
  const user = await prisma.user.findUnique({ where: { id: payload.id } });
  if (!user) throw unauthorized('User not found');
  // Offboarding (A1-01): a disabled account keeps no way back in.
  if (user.disabledAt) throw unauthorized('Account disabled', 'ACCOUNT_DISABLED');
  if (!(await isSessionActive(sid))) throw unauthorized('Session revoked', 'SESSION_REVOKED');
  await touchSession(sid);
  const next = { id: user.id, email: user.email, role: user.role, sid };
  return { accessToken: signAccessToken(next), refreshToken: signRefreshToken(next) };
}

/**
 * Ends the session a refresh token belongs to (logout from the refresh cookie). Needs no access token: a
 * page whose access token has already expired must still be able to log out for good — otherwise the
 * cookie would quietly reopen the session at the next load. An unreadable or expired token has nothing left
 * to revoke.
 */
export async function endSession(refreshToken: string | null): Promise<void> {
  const payload = refreshToken ? verifyToken(refreshToken) : null;
  if (!payload || payload.kind !== 'refresh' || !payload.sid) return;
  await revokeSession(payload.sid, payload.id);
}
