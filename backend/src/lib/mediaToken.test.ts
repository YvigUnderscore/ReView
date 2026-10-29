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
  it('accepts its own token for the named media and player', () => {
    expect(verifyMediaPlaybackToken(signMediaPlaybackToken(42, 7), 42, 7)).toBe(true);
  });

  it('refuses a token signed with another secret', () => {
    const forged = jwt.sign({ kind: 'media-playback', mediaId: 42, uid: 7 }, 'un-autre-secret');
    expect(verifyMediaPlaybackToken(forged, 42, 7)).toBe(false);
  });

  it('refuses a token whose body was modified after signing', () => {
    const [header, , signature] = signMediaPlaybackToken(42, 7).split('.');
    const tampered = Buffer.from(JSON.stringify({ kind: 'media-playback', mediaId: 43, uid: 7 })).toString(
      'base64url',
    );
    expect(verifyMediaPlaybackToken(`${header}.${tampered}.${signature}`, 43, 7)).toBe(false);
  });

  it('refuses a missing token', () => {
    expect(verifyMediaPlaybackToken(undefined, 42, 7)).toBe(false);
    expect(verifyMediaPlaybackToken('', 42, 7)).toBe(false);
    expect(verifyMediaPlaybackToken('pas-un-jwt', 42, 7)).toBe(false);
  });
});

describe('mediaToken — expiry', () => {
  it('refuses a token whose lifetime has elapsed', () => {
    const expired = jwt.sign({ kind: 'media-playback', mediaId: 42, uid: 7 }, env.JWT_SECRET, {
      expiresIn: -10,
    });
    expect(verifyMediaPlaybackToken(expired, 42, 7)).toBe(false);
  });

  it('issues an explicit lifetime (never a perpetual token)', () => {
    const claims = jwt.decode(signMediaPlaybackToken(42, 7)) as { exp: number; iat: number };
    expect(claims.exp - claims.iat).toBe(HLS_PLAYBACK_TTL_SEC);
  });
});

describe('mediaToken — scope', () => {
  it('is only valid for the media it names', () => {
    const token = signMediaPlaybackToken(42, 7);
    expect(verifyMediaPlaybackToken(token, 43, 7)).toBe(false);
  });

  it('is only valid for the player who obtained it (no lending between accounts)', () => {
    const token = signMediaPlaybackToken(42, 7);
    expect(verifyMediaPlaybackToken(token, 42, 8)).toBe(false);
  });

  it('accepts no other application token, even a well-signed one', () => {
    const access = signAccessToken({ id: 7, email: 'artist@studio.com', role: Role.ARTIST, sid: 'sid-test' });
    expect(verifyMediaPlaybackToken(access, 42, 7)).toBe(false);
    expect(verifyMediaPlaybackToken(signShareSession(42), 42, 7)).toBe(false);
  });

  it('is not accepted as an access token by the authentication middleware', async () => {
    // `authenticate` only admits a payload WITHOUT `kind`: the playback token carries one.
    const { verifyToken } = await import('./jwt');
    const payload = verifyToken(signMediaPlaybackToken(42, 7));
    expect(payload?.kind).toBe('media-playback');
  });
});
