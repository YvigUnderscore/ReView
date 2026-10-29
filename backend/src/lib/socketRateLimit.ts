// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from './logger';

/**
 * Rate limiting of the **Socket.io** surface.
 *
 * The product's only global limiter is mounted on `/api` (`app.ts`). Websocket traffic never goes through it: the front nginx routes it through a separate
 * `location /socket.io/`, and server-side `io.use(...)` only runs an authentication. An authenticated connection — including that of a CLIENT, the weakest role
 * in the product — could therefore emit events with no counter at all. Yet the handlers query the database BEFORE refusing: `join_review` costs two Postgres queries
 * per refused identifier. A few thousand emissions per second on ONE websocket saturate the Prisma pool, and the whole instance slows down. Amplification variant:
 * a large `live:sync` frame copied to each participant of a dailies room.
 *
 * The remedy is a **per-connection token bucket**:
 *
 * - each event costs tokens, **more when it touches the database** (`join_review`, `live:join`) than when it merely relays (`live:sync`, `activity`);
 * - the size of the payload is charged on top, and a frankly oversized frame is refused outright: that is the amplification ceiling;
 * - beyond the budget, the packet is **silently ignored** — the handler is not called, so no database query is issued. No error is returned: a legitimate client
 *   need not see an exception, and an abusive client need not receive a feedback signal;
 * - a *sustained* overrun (the rejection counter is only reset when the bucket has refilled — that is, when the connection has gone quiet) closes the connection.
 *
 * The module is **decoupled from `SocketService`**: it only knows a minimal socket shape (`use` / `disconnect`), which makes it testable without a server and avoids
 * locking a security boundary inside an inaccessible closure.
 *
 * ## Calibration (measured on the client, not estimated)
 *
 * The bucket is **per connection**, and a dailies room of thirty participants is thirty connections, hence thirty buckets: the number of viewers does not multiply
 * the throughput of ONE client. The legitimate ceiling is that of the **pilot**, the only one emitting continuously:
 *
 * | Source (front end)                                | Rate    |
 * |---------------------------------------------------|---------|
 * | `useLiveSession` — periodic `live:sync` broadcast | ≤ 30 Hz (`syncHz` bounded to 30) |
 * | `usePointerBroadcast` — cursor, on `live:sync`    | ~20 Hz (`POINTER_INTERVAL_MS = 50`) |
 * | `usePresence` — `activity` on each keystroke/click | ~10 Hz under sustained typing |
 *
 * That is **≈ 60 events per second for a perfectly honest pilot**. The first setting (60 tokens/s) was therefore calibrated *exactly* on this ceiling: the slightest
 * `setInterval` jitter, a navigation `join_review` or a co-pilot taking over during a drag was enough to drop frames — and 200 rejections without a return to calm
 * CLOSE the connection. A limiter that disconnects the pilot from a client projection is worse than no limiter: it would be disarmed at the first complaint.
 *
 * Hence 120 tokens/s, which leave a factor of two over the measured regime. So that this doubling does not relax the bound that counts — the Postgres query count —
 * **the costs of events touching the database are doubled at the same time**: at 12 tokens, `join_review` is still limited to ten attempts per second, i.e. twenty queries,
 * exactly as before. And so that the doubling does not double the amplification either (a frame relayed to thirty participants), the payload ceiling goes from 32 KiB to 8 KiB and
 * the charged slice from 4 KiB to 2 KiB: the largest acceptable frame now costs 5 tokens instead of 9, i.e. ~24 frames/s instead of 6.6 — but at 8 KiB instead of 32, so **fewer**
 * bytes relayed than with the original settings. No legitimate frame approaches 2 KiB (a `LiveSyncPayload` = playhead, pause, camera, wipe: a few hundred bytes).
 */

/** Tokens of the full bucket: two seconds of reserve, to absorb the opening of a screen. */
export const DEFAULT_CAPACITY = 240;

/** Refill, in tokens per second: the tolerated steady state (2× the measured pilot). */
export const DEFAULT_REFILL_PER_SECOND = 120;

/**
 * Cost of an unlisted event. Deliberately above the relay events: an event name unknown to the server has no handler, yet it still goes through the parser
 * and the log — and that is the least watched door.
 */
export const DEFAULT_COST = 4;

/**
 * Cost per event. The entry points that **resolve a project in the database before refusing** are the most expensive: `join_review` costs two Postgres queries
 * per refused identifier, `join_project` a revalidation plus an RBAC check. At 12 tokens, a connection is capped at ten attempts per second in steady state — incomparable
 * with the 32,000 events per second measured in the absence of a counter.
 *
 * `join_project` / `leave_project` are listed because they are open to ALL sockets, share guest included (they live outside the `if (socket.user)` block): leaving them at the
 * default cost would have left the most exposed surface three times cheaper than the same operation on a review.
 */
export const DEFAULT_COSTS: Readonly<Record<string, number>> = {
  join_review: 12,
  'live:join': 12,
  join_project: 12,
  leave_review: 1,
  'live:leave': 1,
  leave_project: 1,
  'live:sync': 1,
  'live:handoff': 6,
  'live:cohost': 6,
  activity: 1,
};

/**
 * Beyond this, the frame is refused without being relayed. No legitimate frame approaches it: `live:sync` carries a playhead, a pause state, a camera — a few hundred
 * bytes. This is the amplification ceiling: what enters here comes out multiplied by the number of participants in the room.
 */
export const DEFAULT_MAX_PAYLOAD_BYTES = 8 * 1024;

/**
 * Slice of payload charged one additional token. Wide enough that a legitimate frame pays nothing, fine enough that the cost follows the size on heavy frames.
 */
const PAYLOAD_TOKEN_BYTES = 2048;

/** Consecutive rejections (without a return to calm) before the connection is closed. */
export const DEFAULT_DROPS_BEFORE_DISCONNECT = 200;

export interface SocketRateLimitOptions {
  capacity?: number;
  refillPerSecond?: number;
  costs?: Readonly<Record<string, number>>;
  defaultCost?: number;
  maxPayloadBytes?: number;
  dropsBeforeDisconnect?: number;
  /** Injectable clock: the tests drive time rather than wait for it. */
  now?: () => number;
}

interface ResolvedOptions {
  capacity: number;
  refillPerSecond: number;
  costs: Readonly<Record<string, number>>;
  defaultCost: number;
  maxPayloadBytes: number;
  dropsBeforeDisconnect: number;
}

/** State of a connection's bucket. Deliberately bare: one connection, one object, nothing global. */
export interface SocketBudget {
  tokens: number;
  lastRefillAt: number;
  /** Rejections since the last return to calm — used to tell a burst from abuse. */
  drops: number;
}

export type PacketVerdict = 'allow' | 'drop' | 'disconnect';

export function resolveOptions(options: SocketRateLimitOptions = {}): ResolvedOptions {
  return {
    capacity: options.capacity ?? DEFAULT_CAPACITY,
    refillPerSecond: options.refillPerSecond ?? DEFAULT_REFILL_PER_SECOND,
    costs: options.costs ?? DEFAULT_COSTS,
    defaultCost: options.defaultCost ?? DEFAULT_COST,
    maxPayloadBytes: options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    dropsBeforeDisconnect: options.dropsBeforeDisconnect ?? DEFAULT_DROPS_BEFORE_DISCONNECT,
  };
}

/** Bucket full at connection time: the first burst of a screen that opens is legitimate. */
export function createBudget(now: number, options: SocketRateLimitOptions = {}): SocketBudget {
  return { tokens: resolveOptions(options).capacity, lastRefillAt: now, drops: 0 };
}

/**
 * Weight of a payload, in bytes. Simple shapes are measured without serialising; a circular structure (or otherwise non-serialisable) is counted as oversized —
 * it cannot in any case come from an honest Socket.io client.
 */
export function estimatePayloadBytes(args: readonly unknown[]): number {
  let total = 0;
  for (const arg of args) {
    if (arg === null || arg === undefined || typeof arg === 'number' || typeof arg === 'boolean') {
      total += 8;
      continue;
    }
    if (typeof arg === 'string') {
      total += Buffer.byteLength(arg, 'utf-8');
      continue;
    }
    if (arg instanceof ArrayBuffer) {
      total += arg.byteLength;
      continue;
    }
    if (ArrayBuffer.isView(arg)) {
      total += arg.byteLength;
      continue;
    }
    try {
      total += Buffer.byteLength(JSON.stringify(arg) ?? '', 'utf-8');
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
  return total;
}

/** Total cost of a packet: that of the event, plus the size of its payload. */
export function packetCost(event: string, payloadBytes: number, options: ResolvedOptions): number {
  const base = options.costs[event] ?? options.defaultCost;
  if (!Number.isFinite(payloadBytes)) return Number.POSITIVE_INFINITY;
  return base + Math.floor(payloadBytes / PAYLOAD_TOKEN_BYTES);
}

/**
 * Verdict for a packet, and bucket update. `now` is supplied by the caller so that the function stays pure with respect to the clock.
 */
export function admitPacket(
  budget: SocketBudget,
  event: string,
  payloadBytes: number,
  options: ResolvedOptions,
  now: number,
): PacketVerdict {
  // Refill proportional to the elapsed time. A clock that goes backwards (NTP adjustment) must neither credit nor debit: we simply restart from the present instant.
  const elapsedMs = Math.max(0, now - budget.lastRefillAt);
  budget.lastRefillAt = now;
  budget.tokens = Math.min(options.capacity, budget.tokens + (elapsedMs * options.refillPerSecond) / 1000);
  // Full bucket = the connection has gone quiet: the previous burst was a burst, not abuse.
  if (budget.tokens >= options.capacity) budget.drops = 0;

  if (payloadBytes > options.maxPayloadBytes) return countDrop(budget, options);

  const cost = packetCost(event, payloadBytes, options);
  if (cost > budget.tokens) return countDrop(budget, options);

  budget.tokens -= cost;
  return 'allow';
}

function countDrop(budget: SocketBudget, options: ResolvedOptions): PacketVerdict {
  budget.drops += 1;
  return budget.drops >= options.dropsBeforeDisconnect ? 'disconnect' : 'drop';
}

/** Minimal shape of a socket, so as not to depend on `socket.io` or `SocketService`. */
export interface RateLimitedSocket {
  id?: string;
  use(fn: (packet: unknown[], next: (err?: Error) => void) => void): unknown;
  disconnect(close?: boolean): unknown;
}

/**
 * Attaches the limiter to a connection. To be set once per accepted socket, **before** the registration of the event handlers — a `socket.use` middleware
 * applies only to incoming packets and does not depend on the order of the `socket.on` registrations, but setting the guard first keeps the reading obvious.
 */
export function attachSocketRateLimit(
  socket: RateLimitedSocket,
  options: SocketRateLimitOptions = {},
): SocketBudget {
  const resolved = resolveOptions(options);
  const clock = options.now ?? Date.now;
  const budget = createBudget(clock(), options);

  socket.use((packet, next) => {
    const event = typeof packet[0] === 'string' ? packet[0] : '';
    const verdict = admitPacket(budget, event, estimatePayloadBytes(packet.slice(1)), resolved, clock());
    if (verdict === 'allow') {
      next();
      return;
    }
    if (verdict === 'disconnect') {
      logger.warn({ socketId: socket.id, event }, '[socket] débit abusif : connexion fermée');
      socket.disconnect(true);
    }
    // 'drop': `next` is not called, so the handler is not executed and no database query is issued. That is the whole point of refusing BEFORE the handler.
  });

  return budget;
}
