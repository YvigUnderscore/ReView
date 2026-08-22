// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt, { type VerifyOptions } from 'jsonwebtoken';
import { env } from '../config/env';

/**
 * Jeton de lecture média (vague 2 — diffusion HLS hors du process web).
 *
 * Le manifeste maître `/api/media/:id/hls/master.m3u8` est le SEUL point où l'autorisation
 * est vérifiée en base (média publié ou brouillon de son uploader + appartenance au projet).
 * Il émet ce jeton, que les sous-playlists portent en query : la requête suivante coûte une
 * vérification HMAC et zéro aller-retour PostgreSQL. Les segments, eux, ne repassent plus
 * du tout par Node (URL MinIO présignées écrites dans la sous-playlist).
 *
 * Trois propriétés tiennent la sûreté du dispositif, toutes couvertes par les tests :
 *  1. **Portée** — le jeton nomme le média ET l'utilisateur ; il n'ouvre rien d'autre.
 *  2. **Durée** — il expire (`HLS_PLAYBACK_TTL_SEC`), comme les URL présignées qu'il permet
 *     d'obtenir ; le lecteur recharge le manifeste quand elles périment.
 *  3. **Cloisonnement** — il porte `kind: 'media-playback'`, or `middleware/auth` n'accepte
 *     comme jeton d'accès qu'un payload SANS `kind` : ce jeton ne peut donc jamais servir à
 *     authentifier une requête d'API, ni un jeton d'accès à autoriser une lecture ici.
 */

/** Durée de vie du jeton — alignée sur celle des URL présignées de segments. */
export const HLS_PLAYBACK_TTL_SEC = 2 * 60 * 60;

const PLAYBACK_KIND = 'media-playback';

// Même règle que lib/jwt : l'algorithme est fixé des deux côtés, jamais lu dans l'en-tête
// du jeton présenté.
const ALGORITHM = 'HS256' as const;
const VERIFY_OPTIONS: VerifyOptions = { algorithms: [ALGORITHM] };

interface PlaybackClaims {
  kind?: string;
  mediaId?: number;
  uid?: number;
}

/** Jeton de lecture pour ce média et cet utilisateur. */
export function signMediaPlaybackToken(
  mediaId: number,
  userId: number,
  ttlSeconds: number = HLS_PLAYBACK_TTL_SEC,
): string {
  return jwt.sign({ kind: PLAYBACK_KIND, mediaId, uid: userId }, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: ttlSeconds,
  });
}

/** Vrai si `token` est un jeton de lecture valide, non expiré, pour CE média et CE lecteur. */
export function verifyMediaPlaybackToken(
  token: string | undefined | null,
  mediaId: number,
  userId: number,
): boolean {
  if (!token) return false;
  try {
    const claims = jwt.verify(token, env.JWT_SECRET, VERIFY_OPTIONS) as PlaybackClaims;
    return claims.kind === PLAYBACK_KIND && claims.mediaId === mediaId && claims.uid === userId;
  } catch {
    return false;
  }
}
