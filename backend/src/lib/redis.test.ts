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
  it('ne publie rien tant que le transport n’est pas armé', () => {
    const fake = createFakeRedis();
    __redisTesting.setClient(fake);
    publishRedis('canal', 'a');
    expect(fake.published).toEqual([]);
    enableRedisTransport();
    publishRedis('canal', 'b');
    expect(fake.published).toEqual([{ channel: 'canal', payload: 'b' }]);
  });

  it('distribue un message reçu à tous les gestionnaires du canal, et à eux seuls', () => {
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

  it('un gestionnaire qui jette n’empêche pas les suivants d’être servis', () => {
    const suivant = vi.fn();
    subscribeRedis('c', () => {
      throw new Error('boum');
    });
    subscribeRedis('c', suivant);
    __redisTesting.deliver('c', 'x');
    expect(suivant).toHaveBeenCalledOnce();
  });

  it('le double de test remplace intégralement le client de commandes', async () => {
    const fake = createFakeRedis();
    __redisTesting.setClient(fake);
    await getRedis().call('SET', 'k', 'v');
    expect(await getRedis().call('GET', 'k')).toBe('v');
  });
});

describe('battement de cœur', () => {
  it('exécute chaque travail enregistré', async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    onHeartbeat(a);
    onHeartbeat(b);
    await runHeartbeat();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('un travail en échec n’interrompt pas le tour', async () => {
    const suivant = vi.fn().mockResolvedValue(undefined);
    onHeartbeat(() => Promise.reject(new Error('redis absent')));
    onHeartbeat(suivant);
    await expect(runHeartbeat()).resolves.toBeUndefined();
    expect(suivant).toHaveBeenCalledOnce();
  });
});

describe('utilitaires de lecture', () => {
  it('redisStrings normalise une réponse tableau et absorbe le reste', () => {
    expect(redisStrings(['a', 1, null])).toEqual(['a', '1', '']);
    expect(redisStrings(null)).toEqual([]);
  });

  it('redisNullableStrings conserve les trous de MGET', () => {
    expect(redisNullableStrings(['a', null, 2])).toEqual(['a', null, null]);
  });

  it('parseJson rend null sur une charge corrompue plutôt que de jeter', () => {
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('pas du json')).toBeNull();
    expect(parseJson(null)).toBeNull();
  });
});

describe('identité de process', () => {
  it('INSTANCE_ID est court et stable pour la durée du process', () => {
    expect(INSTANCE_ID).toMatch(/^[0-9a-f]{8}$/);
  });
});
