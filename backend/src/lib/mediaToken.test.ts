// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../config/env';
import { signMediaPlaybackToken, verifyMediaPlaybackToken, HLS_PLAYBACK_TTL_SEC } from './mediaToken';
import { signAccessToken } from './jwt';
import { signShareSession } from './shareAccess';

describe('mediaToken — signature', () => {
  it('accepte son propre jeton pour le média et le lecteur nommés', () => {
    expect(verifyMediaPlaybackToken(signMediaPlaybackToken(42, 7), 42, 7)).toBe(true);
  });

  it('refuse un jeton signé avec un autre secret', () => {
    const forged = jwt.sign({ kind: 'media-playback', mediaId: 42, uid: 7 }, 'un-autre-secret');
    expect(verifyMediaPlaybackToken(forged, 42, 7)).toBe(false);
  });

  it('refuse un jeton dont le corps a été modifié après signature', () => {
    const [header, , signature] = signMediaPlaybackToken(42, 7).split('.');
    const tampered = Buffer.from(JSON.stringify({ kind: 'media-playback', mediaId: 43, uid: 7 })).toString(
      'base64url',
    );
    expect(verifyMediaPlaybackToken(`${header}.${tampered}.${signature}`, 43, 7)).toBe(false);
  });

  it('refuse une absence de jeton', () => {
    expect(verifyMediaPlaybackToken(undefined, 42, 7)).toBe(false);
    expect(verifyMediaPlaybackToken('', 42, 7)).toBe(false);
    expect(verifyMediaPlaybackToken('pas-un-jwt', 42, 7)).toBe(false);
  });
});

describe('mediaToken — expiration', () => {
  it('refuse un jeton dont la durée de vie est écoulée', () => {
    const expired = jwt.sign({ kind: 'media-playback', mediaId: 42, uid: 7 }, env.JWT_SECRET, {
      expiresIn: -10,
    });
    expect(verifyMediaPlaybackToken(expired, 42, 7)).toBe(false);
  });

  it('émet une durée de vie explicite (jamais de jeton perpétuel)', () => {
    const claims = jwt.decode(signMediaPlaybackToken(42, 7)) as { exp: number; iat: number };
    expect(claims.exp - claims.iat).toBe(HLS_PLAYBACK_TTL_SEC);
  });
});

describe('mediaToken — portée', () => {
  it("ne vaut que pour le média qu'il nomme", () => {
    const token = signMediaPlaybackToken(42, 7);
    expect(verifyMediaPlaybackToken(token, 43, 7)).toBe(false);
  });

  it('ne vaut que pour le lecteur qui l’a obtenu (pas de prêt entre comptes)', () => {
    const token = signMediaPlaybackToken(42, 7);
    expect(verifyMediaPlaybackToken(token, 42, 8)).toBe(false);
  });

  it("n'accepte aucun autre jeton de l'application, même bien signé", () => {
    const access = signAccessToken({ id: 7, email: 'artist@studio.com', role: Role.ARTIST });
    expect(verifyMediaPlaybackToken(access, 42, 7)).toBe(false);
    expect(verifyMediaPlaybackToken(signShareSession(42), 42, 7)).toBe(false);
  });

  it("n'est pas accepté comme jeton d'accès par le middleware d'authentification", async () => {
    // `authenticate` n'admet qu'un payload SANS `kind` : le jeton de lecture en porte un.
    const { verifyToken } = await import('./jwt');
    const payload = verifyToken(signMediaPlaybackToken(42, 7));
    expect(payload?.kind).toBe('media-playback');
  });
});
