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
  it('full fallback to the base', () => {
    expect(sanitize({}, FALLBACK)).toEqual(FALLBACK);
  });

  it('normalises publicUrl (trailing slash removed) and truncates', () => {
    const out = sanitize({ publicUrl: 'https://studio.example.com/' }, FALLBACK);
    expect(out.publicUrl).toBe('https://studio.example.com');
  });

  it('ignores invalid types', () => {
    const out = sanitize({ enabled: 'oui', clientId: 42, autoProvision: 1 }, FALLBACK);
    expect(out.enabled).toBe(false);
    expect(out.clientId).toBe('');
    expect(out.autoProvision).toBe(false);
  });

  it('keeps the supplied fields', () => {
    const out = sanitize(
      { enabled: true, issuer: ' https://accounts.google.com ', clientId: 'abc', buttonLabel: 'SSO' },
      FALLBACK,
    );
    expect(out.enabled).toBe(true);
    expect(out.issuer).toBe('https://accounts.google.com');
    expect(out.clientId).toBe('abc');
    expect(out.buttonLabel).toBe('SSO');
  });

  it('accepts a logo under branding/ and empty, discards the rest', () => {
    expect(sanitize({ logoKey: 'branding/sso-1700.png' }, FALLBACK).logoKey).toBe('branding/sso-1700.png');
    expect(sanitize({ logoKey: '' }, { ...FALLBACK, logoKey: 'branding/sso-1.png' }).logoKey).toBe('');
    // A key outside the prefix must never end up in an <img> of the login page.
    for (const bad of ['avatars/1.png', '../../etc/passwd', 'branding/../secrets/x.png']) {
      expect(sanitize({ logoKey: bad }, FALLBACK).logoKey).toBe('');
    }
  });

  it('passwordLoginDisabled follows the same typed fallback as the other booleans', () => {
    expect(sanitize({ passwordLoginDisabled: true }, FALLBACK).passwordLoginDisabled).toBe(true);
    expect(sanitize({ passwordLoginDisabled: 'oui' }, FALLBACK).passwordLoginDisabled).toBe(false);
  });
});

describe('isOidcReady', () => {
  it('true only if enabled and complete', () => {
    expect(isOidcReady(ready)).toBe(true);
    expect(isOidcReady({ ...ready, enabled: false })).toBe(false);
    expect(isOidcReady({ ...ready, clientId: '' })).toBe(false);
    expect(isOidcReady({ ...ready, clientSecret: '' })).toBe(false);
    expect(isOidcReady({ ...ready, publicUrl: '' })).toBe(false);
  });
});
