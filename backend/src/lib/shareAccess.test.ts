// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { signShareSession, verifyShareSession, shareState } from './shareAccess';
import { signAccessToken } from './jwt';

describe('shareAccess', () => {
  it('signe et vérifie une session pour le bon lien', () => {
    const token = signShareSession(42);
    expect(verifyShareSession(token, 42)).toBe(true);
  });

  it('refuse une session pour un autre lien', () => {
    const token = signShareSession(42);
    expect(verifyShareSession(token, 43)).toBe(false);
  });

  it('refuse un jeton absent ou invalide', () => {
    expect(verifyShareSession(undefined, 1)).toBe(false);
    expect(verifyShareSession('pas-un-jwt', 1)).toBe(false);
  });

  it('refuse un JWT utilisateur classique (kind ≠ share)', () => {
    // Un accès token de connexion ne doit pas ouvrir une session de partage.
    const userToken = signAccessToken({ id: 1, email: 'a@b.c', role: 'ADMIN' });
    expect(verifyShareSession(userToken, 1)).toBe(false);
  });

  describe('shareState', () => {
    const base = { revoked: false, expiresAt: null, maxViews: null, viewCount: 0 };
    it('ok par défaut', () => {
      expect(shareState(base)).toBe('ok');
    });
    it('revoked prioritaire', () => {
      expect(shareState({ ...base, revoked: true })).toBe('revoked');
    });
    it('expired si expiresAt passé', () => {
      expect(shareState({ ...base, expiresAt: new Date(Date.now() - 1000) })).toBe('expired');
      expect(shareState({ ...base, expiresAt: new Date(Date.now() + 60_000) })).toBe('ok');
    });
    it('exhausted si viewCount ≥ maxViews', () => {
      expect(shareState({ ...base, maxViews: 3, viewCount: 3 })).toBe('exhausted');
      expect(shareState({ ...base, maxViews: 3, viewCount: 2 })).toBe('ok');
    });
  });
});
