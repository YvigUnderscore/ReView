import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { Role } from '@prisma/client';

export interface JwtPayload {
  id: number;
  email: string;
  role: Role;
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
