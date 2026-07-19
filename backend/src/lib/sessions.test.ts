import { describe, it, expect } from 'vitest';
import { parseDurationMs, isSessionActive, __testing } from './sessions';

describe('parseDurationMs', () => {
  it('convertit les unités jwt (s/m/h/d)', () => {
    expect(parseDurationMs('45s', 1)).toBe(45_000);
    expect(parseDurationMs('15m', 1)).toBe(900_000);
    expect(parseDurationMs('12h', 1)).toBe(43_200_000);
    expect(parseDurationMs('30d', 1)).toBe(30 * 86_400_000);
  });

  it('repli sur le fallback pour un format inconnu', () => {
    expect(parseDurationMs('bientôt', 123)).toBe(123);
    expect(parseDurationMs('7w', 456)).toBe(456);
  });
});

describe('cache de validité de session', () => {
  it('sert le cache tant que le TTL court (pas de requête DB)', async () => {
    // Un sid inconnu de la DB mais présent en cache « ok » doit être servi du cache :
    // c'est le contrat qui évite une requête par appel API.
    __testing.cacheSet('sid-cache-test', true);
    await expect(isSessionActive('sid-cache-test')).resolves.toBe(true);
  });

  it('une révocation écrase immédiatement le cache', async () => {
    __testing.cacheSet('sid-revoked', true);
    __testing.cacheSet('sid-revoked', false);
    await expect(isSessionActive('sid-revoked')).resolves.toBe(false);
  });
});
