// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { __testing } from './loginAppearance';

const { sanitize, FALLBACK } = __testing;

describe('loginAppearance.sanitize', () => {
  it('repli complet sur la base pour une entrée vide', () => {
    expect(sanitize(undefined, FALLBACK)).toEqual(FALLBACK);
    expect(sanitize({}, FALLBACK)).toEqual(FALLBACK);
  });

  it('borne le voile et le flou', () => {
    expect(sanitize({ overlay: 5, blur: 999 }, FALLBACK)).toMatchObject({ overlay: 0.95, blur: 24 });
    expect(sanitize({ overlay: -1, blur: -3 }, FALLBACK)).toMatchObject({ overlay: 0, blur: 0 });
    expect(sanitize({ blur: 7.6 }, FALLBACK).blur).toBe(8);
  });

  it('accepte les dispositions connues et ignore les autres', () => {
    expect(sanitize({ layout: 'centered' }, FALLBACK).layout).toBe('centered');
    expect(sanitize({ layout: 'diagonale' }, FALLBACK).layout).toBe(FALLBACK.layout);
    expect(sanitize({ bgFit: 'contain' }, FALLBACK).bgFit).toBe('contain');
    expect(sanitize({ bgFit: 'stretch' }, FALLBACK).bgFit).toBe(FALLBACK.bgFit);
  });

  it('traite la clé vide comme un retrait de l’image', () => {
    const base = { ...FALLBACK, bgKey: 'branding/login-bg-1.jpg' };
    expect(sanitize({ bgKey: '' }, base).bgKey).toBeNull();
    expect(sanitize({ bgKey: null }, base).bgKey).toBeNull();
    // Champ absent : l'image en place est conservée (patch partiel).
    expect(sanitize({ overlay: 0.2 }, base).bgKey).toBe('branding/login-bg-1.jpg');
  });

  it('tronque l’accroche et ignore les types invalides', () => {
    expect(sanitize({ tagline: 'x'.repeat(500) }, FALLBACK).tagline).toHaveLength(200);
    expect(sanitize({ tagline: 42, showLogo: 'oui' }, FALLBACK)).toMatchObject({
      tagline: FALLBACK.tagline,
      showLogo: FALLBACK.showLogo,
    });
  });
});
