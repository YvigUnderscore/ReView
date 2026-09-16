// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Socket } from 'socket.io';
import { verifyToken } from '../lib/jwt';
import { isSessionActive } from '../lib/sessions';
import { shareState, verifyShareSession } from '../lib/shareAccess';
import { prisma } from '../lib/prisma';

/**
 * Socket enrichi par la vérification du handshake : soit un membre du studio (`user`),
 * soit un invité arrivé par un lien de partage (`shareProjectId`), jamais les deux.
 */
export interface AuthedSocket extends Socket {
  user?: { id: number; email: string; role: import('@prisma/client').Role };
  /**
   * Session de connexion (36.B) portée par le jeton du handshake.
   *
   * Elle est conservée parce qu'une websocket vit des jours : sans le `sid`, la seule
   * vérification de la session était celle du handshake, et révoquer une session laissait
   * le canal temps réel ouvert. `SocketService` la rejoue périodiquement (A3-02).
   */
  authSid?: string;
  shareProjectId?: number;
}

/** Refus uniforme : le client n'apprend jamais POURQUOI son handshake est rejeté. */
const REFUS = (): Error => new Error('Authentication error');

/**
 * Porte d'entrée du canal temps réel — extraite de `SocketService` pour être testable :
 * un socket donne accès aux mêmes données qu'une requête HTTP, il mérite donc les mêmes
 * garanties que `middleware/auth`, et une garantie que personne ne peut exercer est une
 * garantie qu'on croit avoir.
 */
export const authenticateSocket = async (
  socket: AuthedSocket,
  next: (err?: Error) => void,
): Promise<void> => {
  // Le client pose le jeton dans `auth` (hors query string, donc hors journaux du
  // frontal). La query reste acceptée le temps qu'un onglet ouvert avant la bascule se
  // reconnecte ; elle pourra disparaître ensuite.
  const authToken = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  const token = typeof authToken === 'string' && authToken ? authToken : socket.handshake.query?.token;
  if (typeof token !== 'string' || !token) return next(REFUS());

  // Mêmes garanties que `middleware/auth` côté HTTP — un socket ne doit pas être une
  // porte dérobée. Tous les jetons de l'app sont signés avec le même JWT_SECRET : seul
  // un jeton d'accès (sans `kind`) est recevable. Accepter un `kind: '2fa'` reviendrait
  // à contourner le second facteur, un `refresh`/`share`/`oidc` à confondre les usages.
  const payload = verifyToken(token);
  if (payload) {
    if (payload.kind !== undefined || typeof payload.id !== 'number') return next(REFUS());

    // Session revoked (36.B) : la déconnexion doit aussi fermer le canal temps réel.
    // Un jeton sans `sid` est refusé comme côté HTTP — sinon le socket resterait la
    // seule porte qu'aucune révocation ne ferme.
    if (!payload.sid || !(await isSessionActive(payload.sid))) return next(REFUS());

    // Zombie-token check + rôle courant relu en base (un rôle rétrogradé prend effet).
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, email: true, role: true, disabledAt: true },
    });
    // Offboarding (A1-01) : un compte désactivé n'ouvre pas de canal temps réel. Le socket
    // donne accès aux mêmes données que l'API — il se ferme sur les mêmes conditions.
    if (!dbUser || dbUser.disabledAt) return next(REFUS());
    socket.user = { id: dbUser.id, email: dbUser.email, role: dbUser.role };
    socket.authSid = payload.sid;
    return next();
  }

  // Sinon : token de partage client (ShareLink) — mêmes règles que les routes /api/client
  // (révocation, expiration ET limite de vues atteinte). Un lien protégé par mot de passe
  // exige en plus la session de partage émise après déverrouillage : le token seul est
  // dans l'URL, l'accepter ferait du mot de passe une formalité.
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
