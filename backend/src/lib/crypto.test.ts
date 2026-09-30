// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

vi.mock('../config/env', () => ({
  env: {
    APP_ENCRYPTION_KEY: 'cle-applicative-de-test-0123456789',
    JWT_SECRET: 'jwt-secret-de-test-0123456789',
  },
}));
vi.mock('./logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { env } from '../config/env';
import { logger } from './logger';
import { encryptSecret, decryptSecret, usesDerivedEncryptionKey, __cryptoTesting } from './crypto';

const CLE_INITIALE = 'cle-applicative-de-test-0123456789';

beforeEach(() => {
  vi.clearAllMocks();
  env.APP_ENCRYPTION_KEY = CLE_INITIALE;
  __cryptoTesting.resetLogState();
});

/** Enveloppe à trois champs : le format écrit avant l'empreinte de clé. */
function envelopeHeritee(plain: string, material: string): string {
  const k = createHash('sha256').update(material).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

describe('crypto — rotation de clé (A3-08)', () => {
  it('nomme la rotation dans le journal au lieu de rendre un null muet', () => {
    const enc = encryptSecret('mot-de-passe-smtp');
    env.APP_ENCRYPTION_KEY = 'une-toute-autre-cle-9876543210abc';
    __cryptoTesting.resetLogState();

    expect(decryptSecret(enc)).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [contexte] = vi.mocked(logger.error).mock.calls[0] as [Record<string, unknown>, string];
    expect(contexte.reason).toBe('key-mismatch');
    expect(contexte.remedy).toContain('APP_ENCRYPTION_KEY');
  });

  it("n'inonde pas le journal quand tous les secrets deviennent illisibles", () => {
    const encs = [encryptSecret('a'), encryptSecret('b'), encryptSecret('c')];
    env.APP_ENCRYPTION_KEY = 'une-toute-autre-cle-9876543210abc';
    __cryptoTesting.resetLogState();
    for (const e of encs) expect(decryptSecret(e)).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('déchiffre encore les enveloppes écrites avant l’empreinte de clé', () => {
    expect(decryptSecret(envelopeHeritee('ancien-secret', CLE_INITIALE))).toBe('ancien-secret');
  });

  it('avertit une fois quand la clé dérive de JWT_SECRET', () => {
    env.APP_ENCRYPTION_KEY = undefined;
    __cryptoTesting.resetLogState();
    expect(usesDerivedEncryptionKey()).toBe(true);
    encryptSecret('x');
    encryptSecret('y');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0]![0]).toContain('JWT_SECRET');
  });
});

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
