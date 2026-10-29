// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { logger } from './logger';
import {
  admitPacket,
  attachSocketRateLimit,
  createBudget,
  estimatePayloadBytes,
  packetCost,
  resolveOptions,
  DEFAULT_CAPACITY,
  DEFAULT_MAX_PAYLOAD_BYTES,
  type RateLimitedSocket,
  type SocketBudget,
} from './socketRateLimit';

/**
 * Two properties to hold at the same time, and they pull in opposite directions:
 *
 * - legitimate traffic ALWAYS passes (a dailies room emits `live:sync` at 30 Hz, and the front end emits `activity` on each keystroke);
 * - the audit scenario — `join_review` in a loop on nonexistent identifiers, two Postgres queries per refusal — is stopped BEFORE the handler.
 */

const options = resolveOptions();

/** Emits the event `count` times at `t` and returns the tally of the verdicts. */
function burst(budget: SocketBudget, event: string, count: number, at: number, bytes = 16) {
  const seen = { allow: 0, drop: 0, disconnect: 0 };
  for (let i = 0; i < count; i += 1) seen[admitPacket(budget, event, bytes, options, at)] += 1;
  return seen;
}

beforeEach(() => vi.clearAllMocks());

describe('socketRateLimit — legitimate traffic passes', () => {
  it('lets a minute of a live room at 30 Hz through alongside keyboard input', () => {
    const budget = createBudget(0);
    let dropped = 0;
    // 60 s at 30 frames/s, plus an `activity` every 200 ms (sustained typing).
    for (let tick = 0; tick < 1800; tick += 1) {
      const now = tick * 33;
      if (admitPacket(budget, 'live:sync', 120, options, now) !== 'allow') dropped += 1;
      if (tick % 6 === 0 && admitPacket(budget, 'activity', 8, options, now) !== 'allow') dropped += 1;
    }
    expect(dropped).toBe(0);
  });

  it('absorbs the opening burst of a screen (several joins at once)', () => {
    const budget = createBudget(0);
    expect(burst(budget, 'join_review', 12, 0)).toMatchObject({ allow: 12, drop: 0 });
  });
});

describe('socketRateLimit — the audit scenario is stopped', () => {
  it('bounds a loop of `join_review` to a handful of passes per burst', () => {
    const budget = createBudget(0);
    const seen = burst(budget, 'join_review', 500, 0);
    // 240 tokens / 12 per join = 20 passes, then nothing until the bucket refills.
    expect(seen.allow).toBe(20);
    expect(seen.drop + seen.disconnect).toBe(480);
  });

  /**
   * The calibration doubled the refill (the pilot's legitimate regime was brushing against it), but the bound that counts is that of the Postgres queries: it must NOT
   * have moved. Ten `join_review` per second in steady state, i.e. twenty queries — that is the contract.
   */
  it('holds ten `join_review` per second in steady state, no more', () => {
    const budget = createBudget(0);
    burst(budget, 'join_review', 100, 0); // empties the bucket
    let allowed = 0;
    // Ten seconds of hammering, twenty attempts per 100 ms slice.
    for (let ms = 100; ms <= 10_000; ms += 100) allowed += burst(budget, 'join_review', 20, ms).allow;
    expect(allowed).toBe(100);
  });

  it('closes the connection on a sustained overrun', () => {
    const budget = createBudget(0);
    const seen = burst(budget, 'join_review', 500, 0);
    expect(seen.disconnect).toBeGreaterThan(0);
  });

  it('does not count as abuse a burst followed by a return to calm', () => {
    const budget = createBudget(0);
    burst(budget, 'join_review', 100, 0);
    expect(budget.drops).toBeGreaterThan(0);
    // Two seconds of silence: the bucket refills, the abuse counter falls back.
    admitPacket(budget, 'activity', 8, options, 2000);
    expect(budget.drops).toBe(0);
  });

  it('refills exactly at the announced rate', () => {
    const budget = createBudget(0);
    burst(budget, 'live:sync', 300, 0); // empties the bucket
    expect(admitPacket(budget, 'live:sync', 8, options, 0)).not.toBe('allow');
    // 100 ms later: 12 tokens refilled, twelve frames pass, the thirteenth does not.
    expect(burst(budget, 'live:sync', 20, 100)).toMatchObject({ allow: 12 });
  });
});

describe('socketRateLimit — amplification by size', () => {
  it('refuses an oversized frame without ever relaying it', () => {
    const budget = createBudget(0);
    const verdict = admitPacket(budget, 'live:sync', DEFAULT_MAX_PAYLOAD_BYTES + 1, options, 0);
    expect(verdict).not.toBe('allow');
    expect(budget.tokens).toBe(DEFAULT_CAPACITY);
  });

  it('charges the payload on top of the cost of the event', () => {
    expect(packetCost('live:sync', 0, options)).toBe(1);
    // A real `LiveSyncPayload` (playhead, pause, camera, wipe) weighs a few hundred bytes: it must pay NOTHING more, otherwise the pilot would be strangled.
    expect(packetCost('live:sync', 900, options)).toBe(1);
    expect(packetCost('live:sync', DEFAULT_MAX_PAYLOAD_BYTES, options)).toBe(5);
    expect(packetCost('inconnu', 0, options)).toBe(options.defaultCost);
  });

  /**
   * Doubling the refill must not double the amplification: what enters here comes out multiplied by the number of participants in the room. The payload ceiling and
   * the charged slice were tightened accordingly — the throughput of relayable bytes through a connection stays below what the original settings allowed (32 KiB at 6.6 frames/s,
   * i.e. ~213 KiB/s).
   */
  it('does not relay more bytes than before the refill increase', () => {
    const budget = createBudget(0);
    const bytes = DEFAULT_MAX_PAYLOAD_BYTES;
    // Reserve emptied: we measure the PERMANENT regime, not the opening burst.
    burst(budget, 'live:sync', 100, 0, bytes);
    let relayed = 0;
    // One second of hammering at the maximum accepted size, in 10 ms slices.
    for (let ms = 10; ms <= 1000; ms += 10)
      relayed += burst(budget, 'live:sync', 50, ms, bytes).allow * bytes;
    // Original settings: 32 KiB at 60/9 frames per second, i.e. ~211 KiB/s.
    expect(relayed).toBeLessThan((60 / 9) * 32 * 1024);
  });

  it('measures the usual shapes, and counts a circular structure as oversized', () => {
    expect(estimatePayloadBytes(['abc'])).toBe(3);
    expect(estimatePayloadBytes([42, true, null])).toBe(24);
    expect(estimatePayloadBytes([{ playhead: 12.5 }])).toBe(17);
    expect(estimatePayloadBytes([new Uint8Array(1000)])).toBe(1000);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(estimatePayloadBytes([circular])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('attachSocketRateLimit — wiring onto a connection', () => {
  function fakeSocket() {
    let middleware: ((packet: unknown[], next: (err?: Error) => void) => void) | null = null;
    const disconnect = vi.fn();
    const socket: RateLimitedSocket = {
      id: 'sock-1',
      use: (fn) => {
        middleware = fn;
        return socket;
      },
      disconnect,
    };
    return {
      socket,
      disconnect,
      emit(event: string, ...args: unknown[]) {
        const next = vi.fn();
        middleware!([event, ...args], next);
        return next;
      },
    };
  }

  it('does not call the handler of a refused packet', () => {
    const clock = { t: 0 };
    const fake = fakeSocket();
    attachSocketRateLimit(fake.socket, { now: () => clock.t });
    // Twenty joins pass, the twenty-first never reaches the handler — that is to say no Postgres query.
    for (let i = 0; i < 20; i += 1) expect(fake.emit('join_review', i)).toHaveBeenCalledOnce();
    expect(fake.emit('join_review', 21)).not.toHaveBeenCalled();
    expect(fake.disconnect).not.toHaveBeenCalled();
  });

  it('closes the connection and logs it on a sustained abuse', () => {
    const fake = fakeSocket();
    attachSocketRateLimit(fake.socket, { now: () => 0 });
    for (let i = 0; i < 500; i += 1) fake.emit('join_review', i);
    expect(fake.disconnect).toHaveBeenCalledWith(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ socketId: 'sock-1', event: 'join_review' }),
      expect.any(String),
    );
  });

  it('refuses an oversized frame without closing an otherwise honest connection', () => {
    const fake = fakeSocket();
    attachSocketRateLimit(fake.socket, { now: () => 0 });
    expect(
      fake.emit('live:sync', 'k', { blob: 'x'.repeat(DEFAULT_MAX_PAYLOAD_BYTES) }),
    ).not.toHaveBeenCalled();
    expect(fake.disconnect).not.toHaveBeenCalled();
    expect(fake.emit('live:sync', 'k', { playhead: 1 })).toHaveBeenCalledOnce();
  });
});
