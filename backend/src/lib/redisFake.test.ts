// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach } from 'vitest';
import { createFakeRedis, type FakeRedis } from './redisFake';

/**
 * The double is the bedrock of all the volatile-state suites: if it lies about a return value or about expiry, it "validates" wrong code.
 * It is therefore verified itself, command by command, against the documented contract of Redis.
 */

let redis: FakeRedis;
let clock = 1_000_000;

beforeEach(() => {
  redis = createFakeRedis();
  clock = 1_000_000;
  redis.now = () => clock;
});

describe('redisFake — strings and expiry', () => {
  it('SET/GET returns the value, DEL counts the keys actually removed', async () => {
    expect(await redis.call('SET', 'a', 'x')).toBe('OK');
    expect(await redis.call('GET', 'a')).toBe('x');
    expect(await redis.call('GET', 'absente')).toBeNull();
    expect(await redis.call('DEL', 'a', 'absente')).toBe(1);
    expect(await redis.call('GET', 'a')).toBeNull();
  });

  it('SET NX refuses to overwrite, and becomes possible again once the key has expired', async () => {
    expect(await redis.call('SET', 'lock', 'un', 'PX', 100, 'NX')).toBe('OK');
    expect(await redis.call('SET', 'lock', 'deux', 'PX', 100, 'NX')).toBeNull();
    clock += 101;
    expect(await redis.call('SET', 'lock', 'deux', 'PX', 100, 'NX')).toBe('OK');
    expect(await redis.call('GET', 'lock')).toBe('deux');
  });

  it('PEXPIRE only applies to a live key; PTTL tells absent and no-lease apart', async () => {
    expect(await redis.call('PEXPIRE', 'fantome', 50)).toBe(0);
    expect(await redis.call('PTTL', 'fantome')).toBe(-2);
    await redis.call('SET', 'b', 'y');
    expect(await redis.call('PTTL', 'b')).toBe(-1);
    expect(await redis.call('PEXPIRE', 'b', 50)).toBe(1);
    expect(await redis.call('PTTL', 'b')).toBe(50);
    clock += 51;
    expect(await redis.call('GET', 'b')).toBeNull();
  });

  it('MGET keeps the holes', async () => {
    await redis.call('SET', 'a', '1');
    expect(await redis.call('MGET', 'a', 'b')).toEqual(['1', null]);
  });
});

describe('redisFake — sets, hashes, sorted sets', () => {
  it('SADD/SREM/SMEMBERS count the effective additions and removals', async () => {
    expect(await redis.call('SADD', 's', 'x', 'y', 'x')).toBe(2);
    expect(await redis.call('SMEMBERS', 's')).toEqual(['x', 'y']);
    expect(await redis.call('SREM', 's', 'x', 'z')).toBe(1);
    expect(await redis.call('SMEMBERS', 's')).toEqual(['y']);
  });

  it('HSET counts the new fields, HGETALL returns a flat list, HDEL removes', async () => {
    expect(await redis.call('HSET', 'h', 'f1', 'a', 'f2', 'b')).toBe(2);
    expect(await redis.call('HSET', 'h', 'f1', 'c')).toBe(0);
    expect(await redis.call('HGETALL', 'h')).toEqual(['f1', 'c', 'f2', 'b']);
    expect(await redis.call('HDEL', 'h', 'f1', 'inconnu')).toBe(1);
    expect(await redis.call('HGETALL', 'h')).toEqual(['f2', 'b']);
  });

  it('the lease applies to the whole hash', async () => {
    await redis.call('HSET', 'h', 'f', 'v');
    await redis.call('PEXPIRE', 'h', 30);
    clock += 31;
    expect(await redis.call('HGETALL', 'h')).toEqual([]);
  });

  it('ZRANGEBYSCORE filters by score and sorts, ZREMRANGEBYSCORE purges the past', async () => {
    await redis.call('ZADD', 'z', 30, 'c', 10, 'a', 20, 'b');
    expect(await redis.call('ZRANGEBYSCORE', 'z', '-inf', '+inf')).toEqual(['a', 'b', 'c']);
    expect(await redis.call('ZRANGEBYSCORE', 'z', 20, '+inf')).toEqual(['b', 'c']);
    expect(await redis.call('ZREMRANGEBYSCORE', 'z', '-inf', 15)).toBe(1);
    expect(await redis.call('ZRANGEBYSCORE', 'z', '-inf', '+inf')).toEqual(['b', 'c']);
    expect(await redis.call('ZREM', 'z', 'b', 'inconnu')).toBe(1);
  });

  it('ZADD overwrites the score of an existing member without counting it as new', async () => {
    expect(await redis.call('ZADD', 'z', 10, 'a')).toBe(1);
    expect(await redis.call('ZADD', 'z', 99, 'a')).toBe(0);
    expect(await redis.call('ZRANGEBYSCORE', 'z', 50, '+inf')).toEqual(['a']);
  });
});

describe('redisFake — instrumentation', () => {
  it('PUBLISH is recorded rather than sent', async () => {
    await redis.call('PUBLISH', 'canal', 'message');
    expect(redis.published).toEqual([{ channel: 'canal', payload: 'message' }]);
  });

  it('counts the commands and can simulate an outage', async () => {
    await redis.call('GET', 'a');
    await redis.call('get', 'b');
    expect(redis.commandCounts.get('GET')).toBe(2);
    redis.failing = true;
    await expect(redis.call('GET', 'a')).rejects.toThrow('fake redis is down');
  });

  it('refuses an unsimulated command rather than returning an invented value', async () => {
    await expect(redis.call('EVALSHA', 'sha', '1', 'k')).rejects.toThrow('unsupported command');
  });
});
