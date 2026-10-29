// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { parseDurationMs, isSessionActive, __testing } from './sessions';

describe('parseDurationMs', () => {
  it('converts jwt units (s/m/h/d)', () => {
    expect(parseDurationMs('45s', 1)).toBe(45_000);
    expect(parseDurationMs('15m', 1)).toBe(900_000);
    expect(parseDurationMs('12h', 1)).toBe(43_200_000);
    expect(parseDurationMs('30d', 1)).toBe(30 * 86_400_000);
  });

  it('falls back on the fallback for an unknown format', () => {
    expect(parseDurationMs('bientôt', 123)).toBe(123);
    expect(parseDurationMs('7w', 456)).toBe(456);
  });
});

describe('session validity cache', () => {
  it('serves the cache while the TTL runs (no DB query)', async () => {
    // A sid unknown to the DB but present in the cache as "ok" must be served from the cache:
    // that is the contract that avoids one query per API call.
    __testing.cacheSet('sid-cache-test', true);
    await expect(isSessionActive('sid-cache-test')).resolves.toBe(true);
  });

  it('a revocation immediately overwrites the cache', async () => {
    __testing.cacheSet('sid-revoked', true);
    __testing.cacheSet('sid-revoked', false);
    await expect(isSessionActive('sid-revoked')).resolves.toBe(false);
  });
});
