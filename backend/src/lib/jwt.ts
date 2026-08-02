// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { Role } from '@prisma/client';

export interface JwtPayload {
  id: number;
  email: string;
  role: Role;
  /** Session de connexion (36.B) — les tokens legacy n'en ont pas (grâce transitoire). */
  sid?: string;
}

export const signAccessToken = (payload: JwtPayload): string =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as SignOptions);

export const signRefreshToken = (payload: JwtPayload): string =>
  jwt.sign({ ...payload, kind: 'refresh' }, env.JWT_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as SignOptions);

export const verifyToken = (token: string): (JwtPayload & { kind?: string }) | null => {
  try {
    return jwt.verify(token, env.JWT_SECRET) as JwtPayload & { kind?: string };
  } catch {
    return null;
  }
};

/** Jeton intermédiaire 2FA (36.A) : émis après mot de passe correct, avant le code TOTP. */
export const signTwoFaToken = (userId: number): string =>
  jwt.sign({ id: userId, kind: '2fa' }, env.JWT_SECRET, { expiresIn: '5m' });

export const verifyTwoFaToken = (token: string): number | null => {
  try {
    const p = jwt.verify(token, env.JWT_SECRET) as { id?: number; kind?: string };
    return p.kind === '2fa' && typeof p.id === 'number' ? p.id : null;
  } catch {
    return null;
  }
};
