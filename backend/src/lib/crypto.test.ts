// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from './crypto';

describe('crypto — secrets chiffrés (Phase 22)', () => {
  it('round-trip chiffre puis déchiffre', () => {
    const secret = 'mon-mot-de-passe-smtp-123';
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret); // pas en clair
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('produit un chiffré différent à chaque appel (IV aléatoire)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('renvoie null sur une valeur altérée ou invalide', () => {
    expect(decryptSecret('nimportequoi')).toBeNull();
    const enc = encryptSecret('secret');
    const tampered = enc.slice(0, -4) + 'AAAA';
    expect(decryptSecret(tampered)).toBeNull();
  });

  it('gère les chaînes vides et unicode', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('');
    expect(decryptSecret(encryptSecret('éà—✓'))).toBe('éà—✓');
  });
});
