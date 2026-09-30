// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { __testing, isOidcReady, type OidcConfig } from './oidcConfig';

vi.mock('../services/StorageService', () => ({ storage: { getPresignedGetUrl: vi.fn() } }));

const { sanitize, FALLBACK } = __testing;

const ready: OidcConfig = {
  ...FALLBACK,
  enabled: true,
  clientId: 'abc',
  clientSecret: 'shh',
  publicUrl: 'https://review.studio.com',
};

describe('oidcConfig.sanitize', () => {
  it('repli complet sur la base', () => {
    expect(sanitize({}, FALLBACK)).toEqual(FALLBACK);
  });

  it('normalise publicUrl (slash final retiré) et tronque', () => {
    const out = sanitize({ publicUrl: 'https://studio.example.com/' }, FALLBACK);
    expect(out.publicUrl).toBe('https://studio.example.com');
  });

  it('ignore les types invalides', () => {
    const out = sanitize({ enabled: 'oui', clientId: 42, autoProvision: 1 }, FALLBACK);
    expect(out.enabled).toBe(false);
    expect(out.clientId).toBe('');
    expect(out.autoProvision).toBe(false);
  });

  it('conserve les champs fournis', () => {
    const out = sanitize(
      { enabled: true, issuer: ' https://accounts.google.com ', clientId: 'abc', buttonLabel: 'SSO' },
      FALLBACK,
    );
    expect(out.enabled).toBe(true);
    expect(out.issuer).toBe('https://accounts.google.com');
    expect(out.clientId).toBe('abc');
    expect(out.buttonLabel).toBe('SSO');
  });

  it('accepte un logo dans branding/ et le vide, écarte le reste', () => {
    expect(sanitize({ logoKey: 'branding/sso-1700.png' }, FALLBACK).logoKey).toBe('branding/sso-1700.png');
    expect(sanitize({ logoKey: '' }, { ...FALLBACK, logoKey: 'branding/sso-1.png' }).logoKey).toBe('');
    // Une clé hors du préfixe ne doit jamais finir dans un <img> de la page de connexion.
    for (const bad of ['avatars/1.png', '../../etc/passwd', 'branding/../secrets/x.png']) {
      expect(sanitize({ logoKey: bad }, FALLBACK).logoKey).toBe('');
    }
  });

  it('passwordLoginDisabled suit le même repli typé que les autres booléens', () => {
    expect(sanitize({ passwordLoginDisabled: true }, FALLBACK).passwordLoginDisabled).toBe(true);
    expect(sanitize({ passwordLoginDisabled: 'oui' }, FALLBACK).passwordLoginDisabled).toBe(false);
  });
});

describe('isOidcReady', () => {
  it('vrai seulement si activé et complet', () => {
    expect(isOidcReady(ready)).toBe(true);
    expect(isOidcReady({ ...ready, enabled: false })).toBe(false);
    expect(isOidcReady({ ...ready, clientId: '' })).toBe(false);
    expect(isOidcReady({ ...ready, clientSecret: '' })).toBe(false);
    expect(isOidcReady({ ...ready, publicUrl: '' })).toBe(false);
  });
});
