import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { isSessionActive } from '../lib/sessions';
import { authenticateApiToken, isApiTokenFormat } from '../lib/apiTokens';

/**
 * Authentifie via JWT (header Authorization: Bearer, ou ?token= en query pour les médias)
 * ou via un token d'API `rvk_…` (36.C — scopes read/write).
 * Conserve le « zombie-token check » du v1 : on revérifie l'existence du user en DB
 * et on recharge son rôle courant (un token reste invalide si le compte est supprimé).
 * 36.B : un JWT portant un `sid` n'est valide que si sa session ne l'est pas moins
 * (révocation effective ≤ 30 s via le cache de lib/sessions).
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const headerToken = req.headers['authorization']?.split(' ')[1];
  const token = headerToken ?? (typeof req.query.token === 'string' ? req.query.token : undefined);

  if (!token) {
    res.status(401).json({ error: 'Non authentifié', code: 'TOKEN_REQUIRED' });
    return;
  }

  // Token d'API (36.C) : lookup par hash + scopes (écriture refusée sans scope write).
  if (isApiTokenFormat(token)) {
    await authenticateApiToken(req, res, next, token);
    return;
  }

  const payload = verifyToken(token);
  if (!payload || payload.kind === 'refresh' || payload.kind === '2fa') {
    res.status(403).json({ error: 'Token invalide', code: 'TOKEN_INVALID' });
    return;
  }

  if (payload.sid && !(await isSessionActive(payload.sid))) {
    res.status(401).json({ error: 'Session révoquée ou expirée', code: 'SESSION_REVOKED' });
    return;
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { id: true, email: true, role: true },
  });

  if (!dbUser) {
    res.status(401).json({ error: 'Utilisateur introuvable', code: 'USER_GONE' });
    return;
  }

  req.user = dbUser;
  req.sessionId = payload.sid;
  next();
};
