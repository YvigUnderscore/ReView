// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { getAuthUser } from '../lib/userCache';
import { isSessionActive } from '../lib/sessions';
import { authenticateApiToken, isApiTokenFormat } from '../lib/apiTokens';

/** `Authorization: Bearer <jeton>` — le schéma est exigé, sa casse est libre. */
const BEARER = /^Bearer[ ]+(.+)$/i;

/**
 * Authentifie via JWT (en-tête `Authorization: Bearer`) ou via un token d'API `rvk_…`
 * (36.C — scopes read/write).
 *
 * ⚠ Le jeton ne se lit QUE dans l'en-tête. Le support historique de `?token=` a été
 * retiré : une URL traverse les journaux applicatifs, ceux du frontal, l'historique du
 * navigateur et l'en-tête `Referer`, là où un en-tête ne va nulle part. Plus aucun
 * appelant n'en dépendait — le lecteur HLS pose son propre `Authorization` (xhrSetup),
 * le socket a son handshake, et `/metrics` lit sa query lui-même dans `app.ts`.
 * Le rétablir rouvrirait la fuite : ajouter un en-tête au client, pas une query ici.
 *
 * Conserve le « zombie-token check » du v1 : on revérifie l'existence du user en DB
 * et on recharge son rôle courant (un token reste invalide si le compte est supprimé).
 * 36.B : un JWT portant un `sid` n'est valide que si sa session ne l'est pas moins
 * (révocation effective ≤ 30 s via le cache de lib/sessions).
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = BEARER.exec(req.headers['authorization'] ?? '')?.[1]?.trim();

  if (!token) {
    res.status(401).json({ error: 'Not authenticated', code: 'TOKEN_REQUIRED' });
    return;
  }

  // Token d'API (36.C) : lookup par hash + scopes (écriture refusée sans scope write).
  if (isApiTokenFormat(token)) {
    await authenticateApiToken(req, res, next, token);
    return;
  }

  // Tous les jetons de l'app (access, refresh, 2fa, session de partage, état OIDC) sont
  // signés avec le même JWT_SECRET : on filtre par liste blanche plutôt que par liste noire.
  // Seul un jeton d'accès (aucun `kind`, portant un id numérique) authentifie une requête —
  // un nouveau type de jeton ajouté demain est ainsi refusé par défaut.
  const payload = verifyToken(token);
  if (!payload || payload.kind !== undefined || typeof payload.id !== 'number') {
    res.status(403).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
    return;
  }

  if (payload.sid && !(await isSessionActive(payload.sid))) {
    res.status(401).json({ error: 'Session revoked or expired', code: 'SESSION_REVOKED' });
    return;
  }

  // Lecture mise en cache 30 s (B3) : sans elle, chaque appel d'API rejouait cette
  // requête, soit vingt à quarante par navigation.
  const dbUser = await getAuthUser(payload.id);

  if (!dbUser) {
    res.status(401).json({ error: 'User not found', code: 'USER_GONE' });
    return;
  }

  req.user = dbUser;
  req.sessionId = payload.sid;
  next();
};
