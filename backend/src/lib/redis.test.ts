// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __redisTesting,
  enableRedisTransport,
  getRedis,
  onHeartbeat,
  parseJson,
  publishRedis,
  redisNullableStrings,
  redisStrings,
  runHeartbeat,
  subscribeRedis,
  INSTANCE_ID,
} from './redis';
import { createFakeRedis } from './redisFake';

beforeEach(() => {
  __redisTesting.reset();
});

describe('transport pub/sub', () => {
  it('publishes nothing as long as the transport is not armed', () => {
    const fake = createFakeRedis();
    __redisTesting.setClient(fake);
    publishRedis('canal', 'a');
    expect(fake.published).toEqual([]);
    enableRedisTransport();
    publishRedis('canal', 'b');
    expect(fake.published).toEqual([{ channel: 'canal', payload: 'b' }]);
  });

  it('delivers a received message to all the handlers of the channel, and to them only', () => {
    const a = vi.fn();
    const b = vi.fn();
    const autre = vi.fn();
    subscribeRedis('c1', a);
    subscribeRedis('c1', b);
    subscribeRedis('c2', autre);
    __redisTesting.deliver('c1', 'charge');
    expect(a).toHaveBeenCalledWith('charge');
    expect(b).toHaveBeenCalledWith('charge');
    expect(autre).not.toHaveBeenCalled();
  });

  it('a handler that throws does not prevent the following ones from being served', () => {
    const suivant = vi.fn();
    subscribeRedis('c', () => {
      throw new Error('boum');
    });
    subscribeRedis('c', suivant);
    __redisTesting.deliver('c', 'x');
    expect(suivant).toHaveBeenCalledOnce();
  });

  it('the test double fully replaces the command client', async () => {
    const fake = createFakeRedis();
    __redisTesting.setClient(fake);
    await getRedis().call('SET', 'k', 'v');
    expect(await getRedis().call('GET', 'k')).toBe('v');
  });
});

describe('shared heartbeat', () => {
  it('runs each registered job', async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    onHeartbeat(a);
    onHeartbeat(b);
    await runHeartbeat();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('a failing job does not interrupt the turn', async () => {
    const suivant = vi.fn().mockResolvedValue(undefined);
    onHeartbeat(() => Promise.reject(new Error('redis absent')));
    onHeartbeat(suivant);
    await expect(runHeartbeat()).resolves.toBeUndefined();
    expect(suivant).toHaveBeenCalledOnce();
  });
});

describe('utilitaires de lecture', () => {
  it('redisStrings normalises an array reply and absorbs the rest', () => {
    expect(redisStrings(['a', 1, null])).toEqual(['a', '1', '']);
    expect(redisStrings(null)).toEqual([]);
  });

  it('redisNullableStrings keeps the holes of MGET', () => {
    expect(redisNullableStrings(['a', null, 2])).toEqual(['a', null, null]);
  });

  it('parseJson returns null on a corrupt payload rather than throwing', () => {
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('pas du json')).toBeNull();
    expect(parseJson(null)).toBeNull();
  });
});

describe('process identity', () => {
  it('INSTANCE_ID is short and stable for the lifetime of the process', () => {
    expect(INSTANCE_ID).toMatch(/^[0-9a-f]{8}$/);
  });
});
