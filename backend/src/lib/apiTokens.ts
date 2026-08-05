// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma';

/**
 * Tokens d'API (36.C, étendus par l'API v1) : `rvk_<40 hex>`, stockés hashés (sha256).
 * Portés dans `Authorization: Bearer` comme un JWT — le middleware les reconnaît à leur
 * préfixe.
 *
 * Deux natures :
 *  - PERSONAL : agit au nom de son porteur, avec le rôle de celui-ci ;
 *  - SERVICE  : adossé à un compte de service (`User.isService`, sans login interactif),
 *    éventuellement cantonné à un projet.
 *
 * Les scopes sont fins (`versions:write`…) et vérifiés route par route par
 * `middleware/scope`. Le garde-fou grossier ci-dessous reste en place pour l'API interne
 * `/api`, qui n'est pas annotée par domaine : elle n'accepte une écriture que si le token
 * porte au moins un scope d'écriture.
 */

export const API_TOKEN_PREFIX = 'rvk_';
/** Scopes hérités, conservés pour les tokens émis avant les scopes fins. */
export const API_SCOPES = ['read', 'write'] as const;

export const isApiTokenFormat = (token: string): boolean => token.startsWith(API_TOKEN_PREFIX);

export const hashApiToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Génère un token en clair (affiché une seule fois) + son hash de stockage. */
export function generateApiToken(): { token: string; tokenHash: string } {
  const token = API_TOKEN_PREFIX + randomBytes(20).toString('hex');
  return { token, tokenHash: hashApiToken(token) };
}

/** Une méthode HTTP est-elle une écriture (scope d'écriture requis) ? */
export const isWriteMethod = (method: string): boolean =>
  !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

/** Le token porte-t-il un droit d'écriture quelconque (legacy `write`, `*:write`, `admin`) ? */
export const grantsAnyWrite = (scopes: readonly string[]): boolean =>
  scopes.some((s) => s === 'write' || s === 'admin' || s.endsWith(':write'));

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
      projectId: true,
      kind: true,
      user: { select: { id: true, email: true, role: true } },
    },
  });
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) {
    res.status(403).json({ error: "Token d'API invalide ou révoqué", code: 'API_TOKEN_INVALID' });
    return;
  }
  if (isWriteMethod(req.method) && !grantsAnyWrite(row.scopes)) {
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
  req.apiToken = {
    id: row.id,
    scopes: row.scopes,
    projectId: row.projectId ?? undefined,
    kind: row.kind,
  };
  next();
}
