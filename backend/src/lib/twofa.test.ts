// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  generateTotpSecret,
  otpauthUri,
  currentTotp,
  verifyTotp,
  generateBackupCodes,
  consumeBackupCode,
  hashBackupCode,
  consumeTotpOnce,
  consumeTotpOnceShared,
  __testing,
} from './twofa';
import { createFakeRedis } from './redisFake';
import { __redisTesting } from './redis';

const redis = createFakeRedis();

beforeEach(() => {
  __testing.usedTotp.clear();
  redis.flush();
  redis.failing = false;
  __redisTesting.setClient(redis);
});

afterAll(() => {
  __redisTesting.reset();
});

describe('shared replay protection across replicas (A3-09)', () => {
  /** What a SECOND replica sees: its process memory is blank. */
  const autreReplique = () => __testing.usedTotp.clear();

  it('rejects on one replica a code already consumed on the other', async () => {
    await expect(consumeTotpOnceShared(7, '123456')).resolves.toBe(true);
    autreReplique();
    await expect(consumeTotpOnceShared(7, '123456')).resolves.toBe(false);
  });

  it('shows that the local guard alone lets this replay through', () => {
    // The defect, isolated: two replicas behind the same front end multiply the chances of an
    // intercepted code, since each only knows its own attempts.
    expect(consumeTotpOnce(7, '123456')).toBe(true);
    autreReplique();
    expect(consumeTotpOnce(7, '123456')).toBe(true);
  });

  it('sets a time-bounded marker', async () => {
    await consumeTotpOnceShared(7, '123456');
    expect(redis.peek('totp:used:7:123456')).toBe('1');
    expect(Number(await redis.call('PTTL', 'totp:used:7:123456'))).toBeGreaterThan(0);
  });

  it('ignores input separators, like the local guard', async () => {
    await expect(consumeTotpOnceShared(7, '123456')).resolves.toBe(true);
    autreReplique();
    await expect(consumeTotpOnceShared(7, ' 123 456 ')).resolves.toBe(false);
  });

  it('rejects the code when the shared marker is unreachable (fail closed)', async () => {
    // An anti-replay store that lost the memory of what was presented cannot answer "never seen":
    // letting it through would make the marker's outage the way to bypass it. No availability is
    // lost in the process: the two limiters of `/verify`, also backed by Redis, already refuse the
    // request upstream.
    redis.failing = true;
    await expect(consumeTotpOnceShared(7, '123456')).resolves.toBe(false);
  });
});

describe('twofa', () => {
  it('a code generated from the secret is accepted, a wrong one is rejected', async () => {
    const secret = generateTotpSecret();
    const code = await currentTotp(secret);
    await expect(verifyTotp(secret, code)).resolves.toBe(true);
    await expect(verifyTotp(secret, ` ${code} `)).resolves.toBe(true); // spaces tolerated
    await expect(verifyTotp(secret, '000000')).resolves.toBe(false);
    await expect(verifyTotp(secret, 'abc')).resolves.toBe(false);
  });

  it('the otpauth URI contains the issuer and the account', () => {
    const uri = otpauthUri('a@b.c', 'ReView Studio', generateTotpSecret());
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('ReView%20Studio');
    expect(uri).toContain('a%40b.c');
  });

  it('backup codes: 10 unique, consumed one by one, case-insensitive', () => {
    const { plain, hashes } = generateBackupCodes();
    expect(new Set(plain).size).toBe(10);
    expect(hashes).toHaveLength(10);
    const rest = consumeBackupCode(hashes, plain[3]!.toUpperCase());
    expect(rest).toHaveLength(9);
    // A consumed code does not come back.
    expect(consumeBackupCode(rest!, plain[3]!)).toBeNull();
    expect(consumeBackupCode(hashes, 'inconnu')).toBeNull();
  });
});

/**
 * Hashes are stored without salt or stretching: the only thing that puts them out of reach of an
 * exhaustive search is the length of the code. 40 bits (the old `randomBytes(5)`) were not enough.
 */
describe('backup codes: entropy and transcription', () => {
  it('carries 128 bits of randomness', () => {
    for (const code of generateBackupCodes().plain) {
      expect(code.replace(/-/g, '')).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('readability separators do not change the hash', () => {
    const { plain, hashes } = generateBackupCodes();
    const bare = plain[0]!.replace(/-/g, '');
    expect(hashBackupCode(bare)).toBe(hashes[0]);
    expect(consumeBackupCode(hashes, ` ${bare.toUpperCase()} `)).toHaveLength(9);
  });

  // Codes issued before the lengthening have neither separator nor uppercase: their hash must
  // remain the one already stored in the database, otherwise the lengthening would log out existing accounts.
  it('codes already in the database (10 hex) keep their hash', () => {
    expect(hashBackupCode('a1b2c3d4e5')).toBe(
      'e32ac31e84e954c4ef30f7a6799948cdf08f30e85de505e237155c9b27265aa5',
    );
  });
});

/**
 * A TOTP code is valid for its whole time step. Once intercepted, it could be replayed for as
 * long as the window lasted: the second factor then no longer proved possession of the phone.
 */
describe('TOTP replay protection', () => {
  it('accepts a code once, rejects it afterwards', () => {
    expect(consumeTotpOnce(7, '123456')).toBe(true);
    expect(consumeTotpOnce(7, '123456')).toBe(false);
  });

  it('consumption is specific to each account', () => {
    expect(consumeTotpOnce(7, '123456')).toBe(true);
    expect(consumeTotpOnce(8, '123456')).toBe(true);
  });

  it('another code from the same account stays accepted', () => {
    expect(consumeTotpOnce(7, '111111')).toBe(true);
    expect(consumeTotpOnce(7, '222222')).toBe(true);
  });

  it('forgets the code once its window has passed', () => {
    expect(consumeTotpOnce(7, '123456')).toBe(true);
    // Forced expiry: we do not depend on a simulated clock for a 2-minute TTL.
    __testing.usedTotp.set('7:123456', Date.now() - 1);
    expect(consumeTotpOnce(7, '123456')).toBe(true);
  });

  it('input spaces do not create a second chance', () => {
    expect(consumeTotpOnce(7, '123456')).toBe(true);
    expect(consumeTotpOnce(7, ' 123 456 ')).toBe(false);
  });
});
