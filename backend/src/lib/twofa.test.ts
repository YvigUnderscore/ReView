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

describe('anti-rejeu partagé entre répliques (A3-09)', () => {
  /** Ce que voit une SECONDE réplique : sa mémoire de process est vierge. */
  const autreReplique = () => __testing.usedTotp.clear();

  it('refuse sur une réplique le code déjà consommé sur l’autre', async () => {
    await expect(consumeTotpOnceShared(7, '123456')).resolves.toBe(true);
    autreReplique();
    await expect(consumeTotpOnceShared(7, '123456')).resolves.toBe(false);
  });

  it('constate que la garde locale seule laisse passer ce rejeu', () => {
    // Le défaut, isolé : deux répliques derrière le même frontal multiplient les chances
    // d'un code intercepté, puisque chacune ne connaît que ses propres tentatives.
    expect(consumeTotpOnce(7, '123456')).toBe(true);
    autreReplique();
    expect(consumeTotpOnce(7, '123456')).toBe(true);
  });

  it('pose un marqueur borné dans le temps', async () => {
    await consumeTotpOnceShared(7, '123456');
    expect(redis.peek('totp:used:7:123456')).toBe('1');
    expect(Number(await redis.call('PTTL', 'totp:used:7:123456'))).toBeGreaterThan(0);
  });

  it('ignore les séparateurs de saisie, comme la garde locale', async () => {
    await expect(consumeTotpOnceShared(7, '123456')).resolves.toBe(true);
    autreReplique();
    await expect(consumeTotpOnceShared(7, ' 123 456 ')).resolves.toBe(false);
  });

  it('refuse le code quand le marqueur partagé est injoignable (échec fermé)', async () => {
    // Un anti-rejeu qui a perdu la mémoire de ce qui a été présenté ne peut pas répondre
    // « jamais vu » : laisser passer ferait de la panne du marqueur le moyen de le
    // contourner. Aucune disponibilité n'est perdue au passage — les deux limiteurs de
    // `/verify`, eux aussi adossés à Redis, refusent déjà la requête en amont.
    redis.failing = true;
    await expect(consumeTotpOnceShared(7, '123456')).resolves.toBe(false);
  });
});

describe('twofa', () => {
  it('un code généré depuis le secret est accepté, un mauvais refusé', async () => {
    const secret = generateTotpSecret();
    const code = await currentTotp(secret);
    await expect(verifyTotp(secret, code)).resolves.toBe(true);
    await expect(verifyTotp(secret, ` ${code} `)).resolves.toBe(true); // espaces tolérés
    await expect(verifyTotp(secret, '000000')).resolves.toBe(false);
    await expect(verifyTotp(secret, 'abc')).resolves.toBe(false);
  });

  it("l'URI otpauth contient l'émetteur et le compte", () => {
    const uri = otpauthUri('a@b.c', 'ReView Studio', generateTotpSecret());
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('ReView%20Studio');
    expect(uri).toContain('a%40b.c');
  });

  it('codes de secours : 10 uniques, consommés un par un, insensibles à la casse', () => {
    const { plain, hashes } = generateBackupCodes();
    expect(new Set(plain).size).toBe(10);
    expect(hashes).toHaveLength(10);
    const rest = consumeBackupCode(hashes, plain[3]!.toUpperCase());
    expect(rest).toHaveLength(9);
    // Un code consommé ne repasse pas.
    expect(consumeBackupCode(rest!, plain[3]!)).toBeNull();
    expect(consumeBackupCode(hashes, 'inconnu')).toBeNull();
  });
});

/**
 * Les hashs sont stockés sans sel ni étirement : la seule chose qui les met hors de portée
 * d'une recherche exhaustive est la longueur du code. 40 bits (l'ancien `randomBytes(5)`)
 * ne suffisaient pas.
 */
describe('codes de secours — entropie et recopie', () => {
  it('porte 128 bits de hasard', () => {
    for (const code of generateBackupCodes().plain) {
      expect(code.replace(/-/g, '')).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('les séparateurs de lisibilité ne changent pas le hash', () => {
    const { plain, hashes } = generateBackupCodes();
    const bare = plain[0]!.replace(/-/g, '');
    expect(hashBackupCode(bare)).toBe(hashes[0]);
    expect(consumeBackupCode(hashes, ` ${bare.toUpperCase()} `)).toHaveLength(9);
  });

  // Les codes émis avant l'allongement n'ont ni séparateur ni majuscule : leur hash doit
  // rester celui déjà stocké en base, sinon l'allongement déconnecte les comptes existants.
  it('les codes déjà en base (10 hex) gardent leur hash', () => {
    expect(hashBackupCode('a1b2c3d4e5')).toBe(
      'e32ac31e84e954c4ef30f7a6799948cdf08f30e85de505e237155c9b27265aa5',
    );
  });
});

/**
 * Un code TOTP vaut pour tout son pas de temps. Intercepté, il se rejouait tant que la
 * fenêtre durait : le second facteur ne prouvait alors plus la possession du téléphone.
 */
describe('anti-rejeu TOTP', () => {
  it('accepte un code une fois, le refuse ensuite', () => {
    expect(consumeTotpOnce(7, '123456')).toBe(true);
    expect(consumeTotpOnce(7, '123456')).toBe(false);
  });

  it('la consommation est propre à chaque compte', () => {
    expect(consumeTotpOnce(7, '123456')).toBe(true);
    expect(consumeTotpOnce(8, '123456')).toBe(true);
  });

  it('un autre code du même compte reste accepté', () => {
    expect(consumeTotpOnce(7, '111111')).toBe(true);
    expect(consumeTotpOnce(7, '222222')).toBe(true);
  });

  it('oublie le code une fois sa fenêtre passée', () => {
    expect(consumeTotpOnce(7, '123456')).toBe(true);
    // Expiration forcée : on ne dépend pas d'une horloge simulée pour un TTL de 2 minutes.
    __testing.usedTotp.set('7:123456', Date.now() - 1);
    expect(consumeTotpOnce(7, '123456')).toBe(true);
  });

  it('les espaces de saisie ne créent pas une seconde chance', () => {
    expect(consumeTotpOnce(7, '123456')).toBe(true);
    expect(consumeTotpOnce(7, ' 123 456 ')).toBe(false);
  });
});
