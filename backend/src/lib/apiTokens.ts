import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma';

/**
 * Tokens d'API personnels (36.C) : `rvk_<40 hex>`, stockés hashés (sha256), scopes
 * `read` / `write`. Portés dans `Authorization: Bearer` comme un JWT — le middleware
 * les reconnaît à leur préfixe. Les méthodes d'écriture exigent le scope `write`.
 */

export const API_TOKEN_PREFIX = 'rvk_';
export const API_SCOPES = ['read', 'write'] as const;

export const isApiTokenFormat = (token: string): boolean => token.startsWith(API_TOKEN_PREFIX);

export const hashApiToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Génère un token en clair (affiché une seule fois) + son hash de stockage. */
export function generateApiToken(): { token: string; tokenHash: string } {
  const token = API_TOKEN_PREFIX + randomBytes(20).toString('hex');
  return { token, tokenHash: hashApiToken(token) };
}

/** Une méthode HTTP est-elle une écriture (scope `write` requis) ? */
export const isWriteMethod = (method: string): boolean =>
  !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

// lastUsedAt : mise à jour throttlée (une écriture / minute / token maximum).
const lastTouched = new Map<number, number>();

/** Authentifie une requête portant un token d'API (appelé par middleware/auth). */
export async function authenticateApiToken(
  req: Request,
  res: Response,
  next: NextFunction,
  token: string,
): Promise<void> {
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(token) },
    select: {
      id: true,
      scopes: true,
      revokedAt: true,
      expiresAt: true,
      user: { select: { id: true, email: true, role: true } },
    },
  });
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) {
    res.status(403).json({ error: "Token d'API invalide ou révoqué", code: 'API_TOKEN_INVALID' });
    return;
  }
  if (isWriteMethod(req.method) && !row.scopes.includes('write')) {
    res.status(403).json({ error: 'Scope write requis', code: 'SCOPE_WRITE_REQUIRED' });
    return;
  }
  const last = lastTouched.get(row.id) ?? 0;
  if (Date.now() - last > 60_000) {
    lastTouched.set(row.id, Date.now());
    void prisma.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
  req.user = row.user;
  req.apiToken = { id: row.id, scopes: row.scopes };
  next();
}
