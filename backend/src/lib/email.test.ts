// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { normalizeEmail } from './email';

describe('normalizeEmail', () => {
  it('met en minuscules et retire les espaces de bord', () => {
    expect(normalizeEmail('Alice@Studio.com')).toBe('alice@studio.com');
    expect(normalizeEmail('  BOB@studio.com \n')).toBe('bob@studio.com');
  });

  // Le SSO OIDC rapproche les comptes sur un email déjà mis en minuscules par le
  // fournisseur : sans cette normalisation à l'écriture, `Alice@…` et `alice@…` sont deux
  // comptes que la contrainte d'unicité ne rapproche pas.
  it('rend les variantes de casse d’une même adresse identiques', () => {
    expect(normalizeEmail('CEO@studio.com')).toBe(normalizeEmail('ceo@studio.com'));
  });

  it('ne fusionne pas des adresses légitimement distinctes', () => {
    // Points et sous-adressage sont propres à certains fournisseurs : on n'y touche pas.
    expect(normalizeEmail('a.b@studio.com')).not.toBe(normalizeEmail('ab@studio.com'));
    expect(normalizeEmail('a+vfx@studio.com')).not.toBe(normalizeEmail('a@studio.com'));
  });
});
