import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';

/**
 * Authentifie via JWT (header Authorization: Bearer, ou ?token= en query pour les médias).
 * Conserve le « zombie-token check » du v1 : on revérifie l'existence du user en DB
 * et on recharge son rôle courant (un token reste invalide si le compte est supprimé).
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const headerToken = req.headers['authorization']?.split(' ')[1];
  const token = headerToken ?? (typeof req.query.token === 'string' ? req.query.token : undefined);

  if (!token) {
    res.status(401).json({ error: 'Non authentifié', code: 'TOKEN_REQUIRED' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(403).json({ error: 'Token invalide', code: 'TOKEN_INVALID' });
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
  next();
};
