// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { __testing } from './oidcConfig';

const { sanitize, FALLBACK } = __testing;

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
});
