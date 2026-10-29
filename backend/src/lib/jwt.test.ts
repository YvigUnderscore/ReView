// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { signAccessToken, signRefreshToken, signTwoFaToken, verifyToken, verifyTwoFaToken } from './jwt';
import { env } from '../config/env';

const payload = { id: 7, email: 'artist@studio.com', role: Role.ARTIST, sid: 'abc' };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('jwt — round trip', () => {
  it("returns the content of an access token", () => {
    expect(verifyToken(signAccessToken(payload))).toMatchObject(payload);
  });

  it('tags the refresh token with its `kind`', () => {
    expect(verifyToken(signRefreshToken(payload))?.kind).toBe('refresh');
  });

  it('the 2FA token can only be read back by its dedicated verifier', () => {
    expect(verifyTwoFaToken(signTwoFaToken(7))).toBe(7);
    expect(verifyTwoFaToken(signAccessToken(payload))).toBeNull();
  });

  it('refuses a signature made with another secret', () => {
    expect(verifyToken(jwt.sign(payload, 'un-autre-secret'))).toBeNull();
  });
});

/**
 * A JWT header is written by whoever presents it: without an enforced algorithm list, it is the token that chooses
 * how its own signature is verified.
 */
describe("jwt — the algorithm is enforced by the server", () => {
  it('refuses a `alg: none` token (empty signature)', () => {
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
    expect(verifyToken(forged)).toBeNull();
    expect(
      verifyTwoFaToken(`${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: 7, kind: '2fa' })}.`),
    ).toBeNull();
  });

  it('refuses an HS512 even though signed with the right secret', () => {
    const other = jwt.sign(payload, env.JWT_SECRET, { algorithm: 'HS512' });
    expect(verifyToken(other)).toBeNull();
  });

  it("does sign with HS256 — which is what verification expects", () => {
    const header = JSON.parse(
      Buffer.from(signAccessToken(payload).split('.')[0]!, 'base64url').toString('utf8'),
    ) as { alg: string };
    expect(header.alg).toBe('HS256');
  });
});
