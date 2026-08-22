// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach } from 'vitest';
import { createFakeRedis, type FakeRedis } from './redisFake';

/**
 * Le double sert de socle à toutes les suites d'état volatil : s'il ment sur une valeur
 * de retour ou sur l'expiration, il « valide » du code faux. On le vérifie donc lui-même,
 * commande par commande, contre le contrat documenté de Redis.
 */

let redis: FakeRedis;
let clock = 1_000_000;

beforeEach(() => {
  redis = createFakeRedis();
  clock = 1_000_000;
  redis.now = () => clock;
});

describe('redisFake — chaînes et expiration', () => {
  it('SET/GET rend la valeur, DEL compte les clés réellement retirées', async () => {
    expect(await redis.call('SET', 'a', 'x')).toBe('OK');
    expect(await redis.call('GET', 'a')).toBe('x');
    expect(await redis.call('GET', 'absente')).toBeNull();
    expect(await redis.call('DEL', 'a', 'absente')).toBe(1);
    expect(await redis.call('GET', 'a')).toBeNull();
  });

  it('SET NX refuse d’écraser, et redevient possible une fois la clé expirée', async () => {
    expect(await redis.call('SET', 'lock', 'un', 'PX', 100, 'NX')).toBe('OK');
    expect(await redis.call('SET', 'lock', 'deux', 'PX', 100, 'NX')).toBeNull();
    clock += 101;
    expect(await redis.call('SET', 'lock', 'deux', 'PX', 100, 'NX')).toBe('OK');
    expect(await redis.call('GET', 'lock')).toBe('deux');
  });

  it('PEXPIRE ne s’applique qu’à une clé vivante ; PTTL distingue absente et sans bail', async () => {
    expect(await redis.call('PEXPIRE', 'fantome', 50)).toBe(0);
    expect(await redis.call('PTTL', 'fantome')).toBe(-2);
    await redis.call('SET', 'b', 'y');
    expect(await redis.call('PTTL', 'b')).toBe(-1);
    expect(await redis.call('PEXPIRE', 'b', 50)).toBe(1);
    expect(await redis.call('PTTL', 'b')).toBe(50);
    clock += 51;
    expect(await redis.call('GET', 'b')).toBeNull();
  });

  it('MGET conserve les trous', async () => {
    await redis.call('SET', 'a', '1');
    expect(await redis.call('MGET', 'a', 'b')).toEqual(['1', null]);
  });
});

describe('redisFake — ensembles, hachages, ensembles ordonnés', () => {
  it('SADD/SREM/SMEMBERS comptent les ajouts et retraits effectifs', async () => {
    expect(await redis.call('SADD', 's', 'x', 'y', 'x')).toBe(2);
    expect(await redis.call('SMEMBERS', 's')).toEqual(['x', 'y']);
    expect(await redis.call('SREM', 's', 'x', 'z')).toBe(1);
    expect(await redis.call('SMEMBERS', 's')).toEqual(['y']);
  });

  it('HSET compte les champs neufs, HGETALL rend une liste plate, HDEL retire', async () => {
    expect(await redis.call('HSET', 'h', 'f1', 'a', 'f2', 'b')).toBe(2);
    expect(await redis.call('HSET', 'h', 'f1', 'c')).toBe(0);
    expect(await redis.call('HGETALL', 'h')).toEqual(['f1', 'c', 'f2', 'b']);
    expect(await redis.call('HDEL', 'h', 'f1', 'inconnu')).toBe(1);
    expect(await redis.call('HGETALL', 'h')).toEqual(['f2', 'b']);
  });

  it('le bail porte sur le hachage entier', async () => {
    await redis.call('HSET', 'h', 'f', 'v');
    await redis.call('PEXPIRE', 'h', 30);
    clock += 31;
    expect(await redis.call('HGETALL', 'h')).toEqual([]);
  });

  it('ZRANGEBYSCORE filtre par score et trie, ZREMRANGEBYSCORE purge le passé', async () => {
    await redis.call('ZADD', 'z', 30, 'c', 10, 'a', 20, 'b');
    expect(await redis.call('ZRANGEBYSCORE', 'z', '-inf', '+inf')).toEqual(['a', 'b', 'c']);
    expect(await redis.call('ZRANGEBYSCORE', 'z', 20, '+inf')).toEqual(['b', 'c']);
    expect(await redis.call('ZREMRANGEBYSCORE', 'z', '-inf', 15)).toBe(1);
    expect(await redis.call('ZRANGEBYSCORE', 'z', '-inf', '+inf')).toEqual(['b', 'c']);
    expect(await redis.call('ZREM', 'z', 'b', 'inconnu')).toBe(1);
  });

  it('ZADD écrase le score d’un membre existant sans le compter comme neuf', async () => {
    expect(await redis.call('ZADD', 'z', 10, 'a')).toBe(1);
    expect(await redis.call('ZADD', 'z', 99, 'a')).toBe(0);
    expect(await redis.call('ZRANGEBYSCORE', 'z', 50, '+inf')).toEqual(['a']);
  });
});

describe('redisFake — instrumentation', () => {
  it('PUBLISH est enregistré plutôt qu’envoyé', async () => {
    await redis.call('PUBLISH', 'canal', 'message');
    expect(redis.published).toEqual([{ channel: 'canal', payload: 'message' }]);
  });

  it('compte les commandes et sait simuler une panne', async () => {
    await redis.call('GET', 'a');
    await redis.call('get', 'b');
    expect(redis.commandCounts.get('GET')).toBe(2);
    redis.failing = true;
    await expect(redis.call('GET', 'a')).rejects.toThrow('fake redis is down');
  });

  it('refuse une commande non simulée plutôt que de rendre une valeur inventée', async () => {
    await expect(redis.call('EVALSHA', 'sha', '1', 'k')).rejects.toThrow('unsupported command');
  });
});
