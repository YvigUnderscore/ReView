// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RedisClientLike } from './redis';

/**
 * Double de test du client Redis (`lib/redis`), en mémoire.
 *
 * L'état volatil (limiteur, présence, salles live, cache d'identité) parle à Redis par
 * une seule méthode — `call(commande, …arguments)` — ce qui rend ce double petit et
 * lisible : il implémente exactement les commandes utilisées, avec leurs valeurs de
 * retour réelles, et une expiration paresseuse. Il est lui-même testé
 * (`redisFake.test.ts`) : un double faux invaliderait tout ce qu'il sert à vérifier.
 *
 * Ce qu'il ne simule PAS, et qui reste donc à vérifier contre un vrai serveur : les
 * scripts Lua (`SCRIPT LOAD`/`EVALSHA`, utilisés par `rate-limit-redis`), le clustering,
 * et l'expiration active côté serveur (ici, une clé expirée n'est retirée qu'à sa
 * prochaine lecture).
 */

type Value = string | Map<string, string> | Map<string, number> | Set<string>;

interface Entry {
  value: Value;
  expiresAt: number | null;
}

export interface FakeRedis extends RedisClientLike {
  /** Horloge injectable : les tests d'expiration ne doivent pas attendre. */
  now: () => number;
  /** Canaux publiés, dans l'ordre — pour vérifier les notifications inter-répliques. */
  published: { channel: string; payload: string }[];
  /** Nombre de commandes reçues, par verbe (mesure du coût d'un scénario). */
  commandCounts: Map<string, number>;
  /** Force l'échec de toute commande (panne Redis simulée). */
  failing: boolean;
  /** Vue brute d'une clé, pour les assertions de structure. */
  peek(key: string): Value | undefined;
  flush(): void;
}

const asString = (v: string | number): string => String(v);

const toScoreBound = (raw: string): number => {
  if (raw === '-inf') return Number.NEGATIVE_INFINITY;
  if (raw === '+inf') return Number.POSITIVE_INFINITY;
  return Number(raw);
};

export function createFakeRedis(): FakeRedis {
  const store = new Map<string, Entry>();

  const fake: FakeRedis = {
    now: () => Date.now(),
    published: [],
    commandCounts: new Map(),
    failing: false,
    peek(key) {
      return live(key)?.value;
    },
    flush() {
      store.clear();
      fake.published.length = 0;
      fake.commandCounts.clear();
    },
    call(command, ...args) {
      const verb = command.toUpperCase();
      fake.commandCounts.set(verb, (fake.commandCounts.get(verb) ?? 0) + 1);
      if (fake.failing) return Promise.reject(new Error('fake redis is down'));
      try {
        return Promise.resolve(run(verb, args.map(asString)));
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    },
  };

  /** Entrée non expirée, ou `undefined` (l'expiration est appliquée à la lecture). */
  function live(key: string): Entry | undefined {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= fake.now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  }

  function hash(key: string, create: boolean): Map<string, string> | undefined {
    const entry = live(key);
    if (entry) return entry.value as Map<string, string>;
    if (!create) return undefined;
    const value = new Map<string, string>();
    store.set(key, { value, expiresAt: null });
    return value;
  }

  function zset(key: string, create: boolean): Map<string, number> | undefined {
    const entry = live(key);
    if (entry) return entry.value as Map<string, number>;
    if (!create) return undefined;
    const value = new Map<string, number>();
    store.set(key, { value, expiresAt: null });
    return value;
  }

  function members(key: string, create: boolean): Set<string> | undefined {
    const entry = live(key);
    if (entry) return entry.value as Set<string>;
    if (!create) return undefined;
    const value = new Set<string>();
    store.set(key, { value, expiresAt: null });
    return value;
  }

  function setString(key: string, args: string[]): string | null {
    const value = args[1] ?? '';
    const flags = args.slice(2).map((f) => f.toUpperCase());
    const nx = flags.includes('NX');
    if (nx && live(key)) return null;
    const pxIndex = flags.indexOf('PX');
    const ttl = pxIndex >= 0 ? Number(flags[pxIndex + 1]) : null;
    store.set(key, { value, expiresAt: ttl === null || Number.isNaN(ttl) ? null : fake.now() + ttl });
    return 'OK';
  }

  function run(verb: string, args: string[]): unknown {
    const key = args[0] ?? '';
    switch (verb) {
      case 'PUBLISH':
        fake.published.push({ channel: key, payload: args[1] ?? '' });
        return 0;

      case 'SET':
        return setString(key, args);
      case 'GET': {
        const entry = live(key);
        return typeof entry?.value === 'string' ? entry.value : null;
      }
      case 'MGET':
        return args.map((k) => {
          const entry = live(k);
          return typeof entry?.value === 'string' ? entry.value : null;
        });
      case 'DEL': {
        let removed = 0;
        for (const k of args) if (live(k) && store.delete(k)) removed += 1;
        return removed;
      }
      case 'PEXPIRE': {
        const entry = live(key);
        if (!entry) return 0;
        entry.expiresAt = fake.now() + Number(args[1] ?? 0);
        return 1;
      }
      case 'PTTL': {
        const entry = live(key);
        if (!entry) return -2;
        return entry.expiresAt === null ? -1 : entry.expiresAt - fake.now();
      }

      case 'SADD': {
        const set = members(key, true)!;
        let added = 0;
        for (const m of args.slice(1)) {
          if (set.has(m)) continue;
          set.add(m);
          added += 1;
        }
        return added;
      }
      case 'SREM': {
        const set = members(key, false);
        if (!set) return 0;
        let removed = 0;
        for (const m of args.slice(1)) if (set.delete(m)) removed += 1;
        if (set.size === 0) store.delete(key);
        return removed;
      }
      case 'SMEMBERS':
        return [...(members(key, false) ?? [])];

      case 'HSET': {
        const map = hash(key, true)!;
        let added = 0;
        for (let i = 1; i + 1 < args.length; i += 2) {
          const field = args[i]!;
          if (!map.has(field)) added += 1;
          map.set(field, args[i + 1]!);
        }
        return added;
      }
      case 'HGETALL': {
        const map = hash(key, false);
        const flat: string[] = [];
        for (const [field, value] of map ?? []) flat.push(field, value);
        return flat;
      }
      case 'HDEL': {
        const map = hash(key, false);
        if (!map) return 0;
        let removed = 0;
        for (const field of args.slice(1)) if (map.delete(field)) removed += 1;
        if (map.size === 0) store.delete(key);
        return removed;
      }

      case 'ZADD': {
        const set = zset(key, true)!;
        let added = 0;
        for (let i = 1; i + 1 < args.length; i += 2) {
          const member = args[i + 1]!;
          if (!set.has(member)) added += 1;
          set.set(member, Number(args[i]));
        }
        return added;
      }
      case 'ZRANGEBYSCORE': {
        const set = zset(key, false);
        const min = toScoreBound(args[1] ?? '-inf');
        const max = toScoreBound(args[2] ?? '+inf');
        return [...(set ?? [])]
          .filter(([, score]) => score >= min && score <= max)
          .sort((a, b) => a[1] - b[1])
          .map(([member]) => member);
      }
      case 'ZREM': {
        const set = zset(key, false);
        if (!set) return 0;
        let removed = 0;
        for (const m of args.slice(1)) if (set.delete(m)) removed += 1;
        if (set.size === 0) store.delete(key);
        return removed;
      }
      case 'ZREMRANGEBYSCORE': {
        const set = zset(key, false);
        if (!set) return 0;
        const min = toScoreBound(args[1] ?? '-inf');
        const max = toScoreBound(args[2] ?? '+inf');
        let removed = 0;
        for (const [member, score] of [...set])
          if (score >= min && score <= max && set.delete(member)) removed += 1;
        if (set.size === 0) store.delete(key);
        return removed;
      }

      default:
        throw new Error(`redisFake: unsupported command "${verb}"`);
    }
  }

  return fake;
}
