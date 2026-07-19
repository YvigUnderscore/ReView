import jwt from 'jsonwebtoken';
import type { ShareLink } from '@prisma/client';
import { env } from '../config/env';

/**
 * Session de partage client (35.C) : après le `GET /api/client/:token` initial (qui compte
 * la vue et applique mot de passe/limite), le serveur émet un JWT court dédié — exigé par
 * toutes les sous-routes publiques. Ainsi la limite de vues et le mot de passe ne peuvent
 * pas être contournés en appelant directement les sous-routes.
 */

const SHARE_SESSION_TTL = '24h';

export function signShareSession(linkId: number): string {
  return jwt.sign({ kind: 'share', linkId }, env.JWT_SECRET, { expiresIn: SHARE_SESSION_TTL });
}

/** Vrai si `token` est une session valide pour ce lien précis. */
export function verifyShareSession(token: string | undefined, linkId: number): boolean {
  if (!token) return false;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { kind?: string; linkId?: number };
    return payload.kind === 'share' && payload.linkId === linkId;
  } catch {
    return false;
  }
}

export type ShareState = 'ok' | 'revoked' | 'expired' | 'exhausted';

/** État d'un lien (pur, testable) — `exhausted` = limite de vues atteinte. */
export function shareState(
  link: Pick<ShareLink, 'revoked' | 'expiresAt' | 'maxViews' | 'viewCount'>,
  now = new Date(),
): ShareState {
  if (link.revoked) return 'revoked';
  if (link.expiresAt && link.expiresAt < now) return 'expired';
  if (link.maxViews != null && link.viewCount >= link.maxViews) return 'exhausted';
  return 'ok';
}
