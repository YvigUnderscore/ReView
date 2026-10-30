// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import Redis, { type RedisOptions } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { logger } from './logger';
import { registerShutdownTask, SHUTDOWN_PHASE } from './gracefulShutdown';

/**
 * Shared Redis access of the API process.
 *
 * Two uses coexist here:
 *
 *  1. `redisConnectionOptions` — **options** (not an instance) for BullMQ, which creates its own client with its bundled version of ioredis;
 *     supplying an instance would bring two copies of ioredis into conflict (dual-package hazard).
 *     `maxRetriesPerRequest: null` is required by the BullMQ workers.
 *
 *  2. **Support for volatile state** (rate limiter, presence, live rooms, identity cache): one command client, one multiplexed subscriber client,
 *     one shared heartbeat. All this state used to live in process memory — two replicas doubled the quotas, and a restart erased the live rooms.
 *
 * The pub/sub transport is **explicitly armed** (`enableRedisTransport`) by the server entry points (`createApp`, `initSocket`). Before that,
 * publishing is a no-op and no network subscription is opened: a unit test that imports a service must not end up connected to Redis, nor hold the event loop.
 */
const url = new URL(env.REDIS_URL);

export const redisConnectionOptions = {
  host: url.hostname,
  port: url.port ? Number(url.port) : 6379,
  username: url.username || undefined,
  password: url.password || undefined,
  db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0,
  maxRetriesPerRequest: null,
} as const;

/**
 * Short identifier of this process. It prefixes the volatile entries: a vanished replica leaves identifiable entries, which their expiry
 * eventually removes.
 */
export const INSTANCE_ID = randomUUID().slice(0, 8);

/**
 * Subset of ioredis actually used by the volatile state. A single method: `call` covers all commands (PUBLISH included), which keeps the
 * test double (`lib/redisFake`) small and verifiable.
 */
export interface RedisClientLike {
  call(command: string, ...args: (string | number)[]): Promise<unknown>;
}

/**
 * A command that has not replied within one second is lost. Without a bound, a Redis outage would never return control: every HTTP request would
 * wait for the reconnection.
 */
const COMMAND_TIMEOUT_MS = 1_000;
/** A Redis outage emits one error per reconnection attempt: only one is logged. */
const ERROR_LOG_THROTTLE_MS = 30_000;
/** Period of the heartbeat (lease refresh, mirror reconciliation). */
export const HEARTBEAT_INTERVAL_MS = 20_000;

function clientOptions(role: string, extra: RedisOptions = {}): RedisOptions {
  return {
    host: redisConnectionOptions.host,
    port: redisConnectionOptions.port,
    username: redisConnectionOptions.username,
    password: redisConnectionOptions.password,
    db: redisConnectionOptions.db,
    connectionName: `review-${role}-${INSTANCE_ID}`,
    maxRetriesPerRequest: 2,
    ...extra,
  };
}

const lastErrorLog = new Map<string, number>();

function attachErrorLogging(client: Redis, role: string): void {
  client.on('error', (err: unknown) => {
    const now = Date.now();
    if (now - (lastErrorLog.get(role) ?? 0) < ERROR_LOG_THROTTLE_MS) return;
    lastErrorLog.set(role, now);
    logger.warn({ err, role }, '[redis] connection error');
  });
}

let commandClient: Redis | null = null;
let subscriberClient: Redis | null = null;
const extraClients = new Set<Redis>();
let testDouble: RedisClientLike | null = null;
let transportEnabled = false;
let shutdownRegistered = false;

function ensureShutdownTask(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  registerShutdownTask({ name: 'redis', phase: SHUTDOWN_PHASE.DISCONNECT, run: closeRedis });
}

/** Shared command client (lazy). The test double replaces it entirely. */
export function getRedis(): RedisClientLike {
  if (testDouble) return testDouble;
  if (!commandClient) {
    commandClient = new Redis(clientOptions('cmd', { commandTimeout: COMMAND_TIMEOUT_MS }));
    attachErrorLogging(commandClient, 'cmd');
    ensureShutdownTask();
  }
  return commandClient;
}

/**
 * Dedicated connection (Socket.io adapter). A client in `subscribe` mode is exclusive: the adapter claims two, which cannot be the command client.
 */
export function createRedisClient(role: string): Redis {
  const client = new Redis(clientOptions(role, { maxRetriesPerRequest: null }));
  attachErrorLogging(client, role);
  extraClients.add(client);
  ensureShutdownTask();
  return client;
}

// ── Multiplexed pub/sub ──

type ChannelHandler = (payload: string) => void;
const handlers = new Map<string, Set<ChannelHandler>>();

function ensureSubscriber(): Redis {
  if (!subscriberClient) {
    subscriberClient = new Redis(clientOptions('sub', { maxRetriesPerRequest: null }));
    attachErrorLogging(subscriberClient, 'sub');
    subscriberClient.on('message', (channel: string, payload: string) => {
      dispatchRedisMessage(channel, payload);
    });
    ensureShutdownTask();
  }
  return subscriberClient;
}

function dispatchRedisMessage(channel: string, payload: string): void {
  for (const handler of handlers.get(channel) ?? []) {
    try {
      handler(payload);
    } catch (err) {
      logger.warn({ err, channel }, '[redis] message handler failed');
    }
  }
}

function openChannel(channel: string): void {
  if (!transportEnabled || testDouble) return;
  void ensureSubscriber()
    .subscribe(channel)
    .catch((err: unknown) => {
      logger.warn({ err, channel }, '[redis] subscription failed');
    });
}

/**
 * Arms the pub/sub transport: opens the subscriptions already requested and allows publications. Called by the server entry points, never by a logic module.
 */
export function enableRedisTransport(): void {
  if (transportEnabled) return;
  transportEnabled = true;
  for (const channel of handlers.keys()) openChannel(channel);
}

/** Registers a channel handler. The network subscription waits for the arming. */
export function subscribeRedis(channel: string, handler: ChannelHandler): void {
  let set = handlers.get(channel);
  if (!set) {
    set = new Set();
    handlers.set(channel, set);
    openChannel(channel);
  }
  set.add(handler);
}

/**
 * Best-effort publication: a lost notification channel is caught up at the next heartbeat (the mirrors reconcile); it must never make the caller fail.
 */
export function publishRedis(channel: string, payload: string): void {
  if (!transportEnabled) return;
  void getRedis()
    .call('PUBLISH', channel, payload)
    .catch((err: unknown) => {
      logger.warn({ err, channel }, '[redis] publish failed');
    });
}

// ── Shared heartbeat ──

const heartbeatTasks = new Set<() => Promise<void>>();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** Runs one heartbeat turn (exported for tests: no clock wait). */
export async function runHeartbeat(): Promise<void> {
  for (const task of heartbeatTasks) {
    try {
      await task();
    } catch (err) {
      logger.warn({ err }, '[redis] heartbeat failed');
    }
  }
}

/**
 * Registers a periodic job local to the process: refreshing the expiry leases of this process's entries, and reconciling the read mirrors. It is not a
 * scheduled job (those are in the BullMQ queue): it only makes sense in the process holding the connections, and must not run twice.
 */
export function onHeartbeat(task: () => Promise<void>): void {
  heartbeatTasks.add(task);
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => void runHeartbeat(), HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
  }
}

// ── Graceful shutdown ──

async function quit(client: Redis): Promise<void> {
  try {
    await client.quit();
  } catch (err) {
    logger.warn({ err }, '[redis] unclean shutdown');
    client.disconnect();
  }
}

/** Closes all Redis connections of the process (shutdown task, DISCONNECT phase). */
export async function closeRedis(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  const clients = [commandClient, subscriberClient, ...extraClients].filter((c): c is Redis => c !== null);
  commandClient = null;
  subscriberClient = null;
  extraClients.clear();
  await Promise.all(clients.map(quit));
}

// ── Read helpers ──

/** Array reply (HGETALL, ZRANGEBYSCORE, SMEMBERS, MGET…) normalised to strings. */
export const redisStrings = (reply: unknown): string[] =>
  Array.isArray(reply) ? reply.map((v) => (v === null || v === undefined ? '' : String(v))) : [];

/** MGET array reply: keeps the holes (`null`) to distinguish an absent key. */
export const redisNullableStrings = (reply: unknown): (string | null)[] =>
  Array.isArray(reply) ? reply.map((v) => (typeof v === 'string' ? v : null)) : [];

/** Defensive parsing of a JSON record stored in Redis (shared channel). */
export function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Test hooks: substitution of the client and injection of pub/sub messages. */
export const __redisTesting = {
  setClient(client: RedisClientLike | null): void {
    testDouble = client;
  },
  deliver(channel: string, payload: string): void {
    dispatchRedisMessage(channel, payload);
  },
  runHeartbeat,
  reset(): void {
    testDouble = null;
    transportEnabled = false;
    handlers.clear();
    heartbeatTasks.clear();
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  },
};
