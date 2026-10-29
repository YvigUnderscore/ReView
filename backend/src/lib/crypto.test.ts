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

/** Three-field envelope: the format written before the key fingerprint existed. */
function envelopeHeritee(plain: string, material: string): string {
  const k = createHash('sha256').update(material).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

describe('crypto — key rotation (A3-08)', () => {
  it('names the rotation in the log instead of returning a silent null', () => {
    const enc = encryptSecret('mot-de-passe-smtp');
    env.APP_ENCRYPTION_KEY = 'une-toute-autre-cle-9876543210abc';
    __cryptoTesting.resetLogState();

    expect(decryptSecret(enc)).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [contexte] = vi.mocked(logger.error).mock.calls[0] as [Record<string, unknown>, string];
    expect(contexte.reason).toBe('key-mismatch');
    expect(contexte.remedy).toContain('APP_ENCRYPTION_KEY');
  });

  it("does not flood the log when all secrets become unreadable", () => {
    const encs = [encryptSecret('a'), encryptSecret('b'), encryptSecret('c')];
    env.APP_ENCRYPTION_KEY = 'une-toute-autre-cle-9876543210abc';
    __cryptoTesting.resetLogState();
    for (const e of encs) expect(decryptSecret(e)).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('still decrypts envelopes written before the key fingerprint', () => {
    expect(decryptSecret(envelopeHeritee('ancien-secret', CLE_INITIALE))).toBe('ancien-secret');
  });

  it('warns once when the key derives from JWT_SECRET', () => {
    env.APP_ENCRYPTION_KEY = undefined;
    __cryptoTesting.resetLogState();
    expect(usesDerivedEncryptionKey()).toBe(true);
    encryptSecret('x');
    encryptSecret('y');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0]![0]).toContain('JWT_SECRET');
  });
});

describe('crypto — encrypted secrets (Phase 22)', () => {
  it('round-trip encrypts then decrypts', () => {
    const secret = 'mon-mot-de-passe-smtp-123';
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret); // not in plaintext
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('produces a different ciphertext on each call (random IV)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('returns null on an altered or invalid value', () => {
    expect(decryptSecret('nimportequoi')).toBeNull();
    const enc = encryptSecret('secret');
    const tampered = enc.slice(0, -4) + 'AAAA';
    expect(decryptSecret(tampered)).toBeNull();
  });

  it('handles empty strings and unicode', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('');
    expect(decryptSecret(encryptSecret('éà—✓'))).toBe('éà—✓');
  });
});
