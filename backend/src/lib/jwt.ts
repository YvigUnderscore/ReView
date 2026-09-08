// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt, { type SignOptions, type VerifyOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { Role } from '@prisma/client';

/**
 * Charge utile SIGNÉE dans un jeton de session (accès et rafraîchissement).
 *
 * ⚠ `sid` est obligatoire, et c'est un invariant de sécurité, pas une commodité : la
 * session est le SEUL point d'accroche d'une révocation. Un jeton sans `sid` ne peut être
 * invalidé par aucune déconnexion, aucun changement de mot de passe, aucun offboarding
 * admin — il resterait valable jusqu'à son expiration naturelle. Tout émetteur crée donc
 * la session (`lib/sessions.createSession`) AVANT de signer.
 */
export interface JwtPayload {
  id: number;
  email: string;
  role: Role;
  /** Session de connexion (36.B) : ce qui rend le jeton révocable. */
  sid: string;
}

/**
 * Charge utile telle qu'elle sort d'un jeton PRÉSENTÉ par un client.
 *
 * Rien ne garantit qu'elle porte un `sid` : les jetons émis avant la phase 36 n'en ont
 * pas, et un client présente ce qu'il veut. Le type le dit au lieu de le taire — c'est
 * `middleware/auth` qui referme le cas (401).
 */
export type VerifiedJwtPayload = Omit<JwtPayload, 'sid'> & { sid?: string; kind?: string };

/**
 * ⚠ L'algorithme est fixé des DEUX côtés, et notamment à la vérification.
 *
 * Sans `algorithms`, `jwt.verify` accepte l'algorithme annoncé par l'en-tête du jeton —
 * c'est-à-dire par celui qui le présente. Le secret partagé deviendrait alors une clé
 * publique HMAC exploitable si une variante asymétrique était introduite un jour, et la
 * liste d'algorithmes acceptés dépendrait de la version de la bibliothèque plutôt que de
 * nous. On la déclare donc explicitement, ici et une seule fois.
 */
const ALGORITHM = 'HS256' as const;
const VERIFY_OPTIONS: VerifyOptions = { algorithms: [ALGORITHM] };

export const signAccessToken = (payload: JwtPayload): string =>
  jwt.sign(payload, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: env.JWT_EXPIRES_IN,
  } as SignOptions);

export const signRefreshToken = (payload: JwtPayload): string =>
  jwt.sign({ ...payload, kind: 'refresh' }, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as SignOptions);

export const verifyToken = (token: string): VerifiedJwtPayload | null => {
  try {
    return jwt.verify(token, env.JWT_SECRET, VERIFY_OPTIONS) as VerifiedJwtPayload;
  } catch {
    return null;
  }
};

/** Jeton intermédiaire 2FA (36.A) : émis après mot de passe correct, avant le code TOTP. */
export const signTwoFaToken = (userId: number): string =>
  jwt.sign({ id: userId, kind: '2fa' }, env.JWT_SECRET, { algorithm: ALGORITHM, expiresIn: '5m' });

export const verifyTwoFaToken = (token: string): number | null => {
  try {
    const p = jwt.verify(token, env.JWT_SECRET, VERIFY_OPTIONS) as { id?: number; kind?: string };
    return p.kind === '2fa' && typeof p.id === 'number' ? p.id : null;
  } catch {
    return null;
  }
};
