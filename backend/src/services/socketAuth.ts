// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Socket } from 'socket.io';
import { verifyToken } from '../lib/jwt';
import { isSessionActive } from '../lib/sessions';
import { shareState, verifyShareSession } from '../lib/shareAccess';
import { prisma } from '../lib/prisma';

/**
 * Socket enriched by the handshake check: either a studio member (`user`) or a guest arriving through a share link (`shareProjectId`), never both.
 */
export interface AuthedSocket extends Socket {
  user?: { id: number; email: string; role: import('@prisma/client').Role };
  /**
   * Connection session (36.B) carried by the handshake token.
   *
   * It is kept because a websocket lives for days: without the `sid`, the only session check was the one at handshake, and revoking a session left the real-time
   * channel open. `SocketService` replays it periodically (A3-02).
   */
  authSid?: string;
  shareProjectId?: number;
}

/** Uniform refusal: the client never learns WHY its handshake is rejected. */
const REFUS = (): Error => new Error('Authentication error');

/**
 * Entry gate of the real-time channel — extracted from `SocketService` so that it can be tested: a socket gives access to the same data as an HTTP request, so it deserves
 * the same guarantees as `middleware/auth`, and a guarantee that nobody can exercise is a guarantee one merely believes one has.
 */
export const authenticateSocket = async (
  socket: AuthedSocket,
  next: (err?: Error) => void,
): Promise<void> => {
  // The client puts the token in `auth` (outside the query string, hence outside the front end's logs). The query is still accepted for as long as a tab opened
  // before the switch reconnects; it may disappear afterwards.
  const authToken = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  const token = typeof authToken === 'string' && authToken ? authToken : socket.handshake.query?.token;
  if (typeof token !== 'string' || !token) return next(REFUS());

  // Same guarantees as `middleware/auth` on the HTTP side — a socket must not be a back door. All the app's tokens are signed with the same JWT_SECRET: only an
  // access token (without `kind`) is acceptable. Accepting a `kind: '2fa'` would amount to bypassing the second factor, a `refresh`/`share`/`oidc` to confusing the uses.
  const payload = verifyToken(token);
  if (payload) {
    if (payload.kind !== undefined || typeof payload.id !== 'number') return next(REFUS());

    // Session revoked (36.B): logging out must also close the real-time channel.
    // A token without `sid` is refused as on HTTP — otherwise the socket would remain the only door that no revocation closes.
    if (!payload.sid || !(await isSessionActive(payload.sid))) return next(REFUS());

    // Zombie-token check + current role re-read from the database (a demoted role takes effect).
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, email: true, role: true, disabledAt: true },
    });
    // Offboarding (A1-01): a deactivated account opens no real-time channel. The socket gives access to the same data as the API — it closes under the same conditions.
    if (!dbUser || dbUser.disabledAt) return next(REFUS());
    socket.user = { id: dbUser.id, email: dbUser.email, role: dbUser.role };
    socket.authSid = payload.sid;
    return next();
  }

  // Otherwise: client share token (ShareLink) — same rules as the /api/client routes (revocation, expiry AND view limit reached). A link protected by a password
  // additionally requires the share session issued after unlocking: the token alone is in the URL, accepting it would make the password a formality.
  const share = await prisma.shareLink.findUnique({ where: { token } });
  if (share && shareState(share) === 'ok') {
    if (share.passwordHash) {
      const shareAuth = socket.handshake.query?.shareAuth;
      if (typeof shareAuth !== 'string' || !verifyShareSession(shareAuth, share.id)) {
        return next(REFUS());
      }
    }
    socket.shareProjectId = share.projectId;
    return next();
  }
  return next(REFUS());
};
