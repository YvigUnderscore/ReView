// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { signAccessToken, signRefreshToken, signTwoFaToken, verifyToken, verifyTwoFaToken } from './jwt';
import { env } from '../config/env';

const payload = { id: 7, email: 'artist@studio.com', role: Role.ARTIST, sid: 'abc' };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('jwt — aller-retour', () => {
  it("rend le contenu d'un jeton d'accès", () => {
    expect(verifyToken(signAccessToken(payload))).toMatchObject(payload);
  });

  it('marque le refresh token de son `kind`', () => {
    expect(verifyToken(signRefreshToken(payload))?.kind).toBe('refresh');
  });

  it('le jeton 2FA ne se relit que par son vérificateur dédié', () => {
    expect(verifyTwoFaToken(signTwoFaToken(7))).toBe(7);
    expect(verifyTwoFaToken(signAccessToken(payload))).toBeNull();
  });

  it('refuse une signature faite avec un autre secret', () => {
    expect(verifyToken(jwt.sign(payload, 'un-autre-secret'))).toBeNull();
  });
});

/**
 * L'en-tête d'un JWT est écrit par celui qui le présente : sans liste d'algorithmes
 * imposée, c'est lui qui choisit comment on vérifie sa propre signature.
 */
describe("jwt — l'algorithme est imposé par le serveur", () => {
  it('refuse un jeton `alg: none` (signature vide)', () => {
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
    expect(verifyToken(forged)).toBeNull();
    expect(
      verifyTwoFaToken(`${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: 7, kind: '2fa' })}.`),
    ).toBeNull();
  });

  it('refuse un HS512 pourtant signé avec le bon secret', () => {
    const other = jwt.sign(payload, env.JWT_SECRET, { algorithm: 'HS512' });
    expect(verifyToken(other)).toBeNull();
  });

  it("signe bien en HS256 — c'est ce que la vérification attend", () => {
    const header = JSON.parse(
      Buffer.from(signAccessToken(payload).split('.')[0]!, 'base64url').toString('utf8'),
    ) as { alg: string };
    expect(header.alg).toBe('HS256');
  });
});
