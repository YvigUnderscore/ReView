// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/**
 * Jeton de désabonnement des envois récurrents (digest, rapport hebdomadaire).
 *
 * Il voyage dans l'en-tête `List-Unsubscribe`, que les messageries transforment en bouton
 * natif. Ce bouton appelle l'adresse **sans session** : le jeton doit donc porter à lui
 * seul l'identité du destinataire et la nature de l'envoi, et prouver qu'il vient de nous.
 *
 * D'où une signature HMAC : le jeton est lisible, mais forger celui d'un autre compte
 * exige la clé du serveur. Sa portée est étroite — il désabonne d'un type d'envoi, rien
 * d'autre : il n'ouvre aucune session, ne lit rien, ne modifie aucune autre préférence.
 */

/** Les envois récurrents dont on peut se désabonner. */
export const UNSUBSCRIBE_KINDS = ['emailDigest', 'weeklyReport'] as const;
export type UnsubscribeKind = (typeof UNSUBSCRIBE_KINDS)[number];

function signature(payload: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url');
}

/** `<userId>.<kind>.<signature>` — lisible, vérifiable, sans état côté serveur. */
export function signUnsubscribe(userId: number, kind: UnsubscribeKind): string {
  const payload = `${userId}.${kind}`;
  return `${payload}.${signature(payload)}`;
}

/** Le destinataire et l'envoi visés, ou `null` si le jeton est forgé ou déformé. */
export function verifyUnsubscribe(token: string): { userId: number; kind: UnsubscribeKind } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawId, rawKind, sig] = parts as [string, string, string];

  const userId = Number(rawId);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  if (!(UNSUBSCRIBE_KINDS as readonly string[]).includes(rawKind)) return null;

  // Comparaison à temps constant : une comparaison ordinaire laisse deviner la signature
  // octet par octet, en mesurant le temps de réponse.
  const expected = Buffer.from(signature(`${rawId}.${rawKind}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  return { userId, kind: rawKind as UnsubscribeKind };
}

/** Adresse publique du désabonnement, telle qu'elle part dans l'en-tête et dans le corps. */
export function unsubscribeUrl(userId: number, kind: UnsubscribeKind): string | null {
  if (!env.APP_URL) return null;
  return `${env.APP_URL}/api/unsubscribe/${signUnsubscribe(userId, kind)}`;
}
