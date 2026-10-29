// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isAbortError, putWithProgress, runPool, throwIfAborted, withRetry } from './uploadTransfer';

/**
 * The three shortcomings of the upload engine are verified here: cutting a transfer in flight,
 * retrying a part without losing the others, and sending only a bounded number of them at once.
 */

type ProgressEvent = { lengthComputable: boolean; loaded: number };

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  headers: Record<string, string> = { ETag: '"deadbeef"' };
  url = '';
  body: Blob | null = null;
  aborted = false;

  open(_method: string, url: string): void {
    this.url = url;
  }
  setRequestHeader(): void {}
  getResponseHeader(name: string): string | null {
    return this.headers[name] ?? null;
  }
  send(body: Blob): void {
    this.body = body;
    FakeXhr.instances.push(this);
  }
  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
}

const blob = new Blob(['xxxx']);
const last = () => FakeXhr.instances[FakeXhr.instances.length - 1];

beforeEach(() => {
  FakeXhr.instances = [];
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('putWithProgress', () => {
  it('returns the part ETag and relays the progress', async () => {
    const seen: number[] = [];
    const p = putWithProgress('https://s3/part1', blob, null, (loaded) => seen.push(loaded));
    last().upload.onprogress?.({ lengthComputable: true, loaded: 2 });
    last().onload?.();
    await expect(p).resolves.toBe('"deadbeef"');
    expect(seen).toEqual([2]);
  });

  it('rejects on HTTP refusal, without confusing it with a cancellation', async () => {
    const p = putWithProgress('https://s3/part1', blob, null, () => {});
    last().status = 503;
    last().onload?.();
    await expect(p).rejects.toThrow();
    await p.catch((err: unknown) => expect(isAbortError(err)).toBe(false));
  });

  it('cuts the in-flight request when the signal is triggered', async () => {
    const ctrl = new AbortController();
    const p = putWithProgress('https://s3/part1', blob, null, () => {}, ctrl.signal);
    const xhr = last();
    ctrl.abort();
    expect(xhr.aborted).toBe(true);
    await p.catch((err: unknown) => expect(isAbortError(err)).toBe(true));
  });

  it('refuses to start if the signal is already triggered (no byte sent)', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await putWithProgress('https://s3/part1', blob, null, () => {}, ctrl.signal).catch((err: unknown) =>
      expect(isAbortError(err)).toBe(true),
    );
    expect(FakeXhr.instances).toHaveLength(0);
  });
});

describe('withRetry', () => {
  it('retries a failed part and eventually succeeds', async () => {
    vi.useFakeTimers();
    const attempts: number[] = [];
    const run = withRetry(async (i) => {
      attempts.push(i);
      if (i < 2) throw new Error('boom');
      return 'ok';
    });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(run).resolves.toBe('ok');
    expect(attempts).toEqual([0, 1, 2]);
  });

  it('gives up after the last retry, rethrowing the original error', async () => {
    vi.useFakeTimers();
    const outcome = withRetry(async () => {
      throw new Error('toujours cassé');
    }).then(
      () => 'réussi',
      (err: Error) => err.message,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBe('toujours cassé');
  });

  it('does not retry a cancellation: the wait is cut off immediately', async () => {
    vi.useFakeTimers();
    const ctrl = new AbortController();
    let calls = 0;
    const outcome = withRetry(async () => {
      calls += 1;
      throw new Error('réseau');
    }, ctrl.signal).then(
      () => false,
      (err: unknown) => isAbortError(err),
    );
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toBe(true);
    expect(calls).toBe(1);
  });
});

describe('runPool', () => {
  it('never runs more tasks than the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const run = runPool([1, 2, 3, 4, 5, 6, 7, 8], 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => release.push(resolve));
      inFlight -= 1;
    });
    await Promise.resolve();
    expect(release).toHaveLength(4); // quatre parts de front, pas huit
    while (release.length > 0) {
      release.splice(0).forEach((fn) => fn());
      await Promise.resolve();
      await Promise.resolve();
    }
    await run;
    expect(peak).toBe(4);
  });

  it('surfaces the first error without leaving an orphan promise', async () => {
    const done: number[] = [];
    await expect(
      runPool([1, 2, 3, 4], 2, async (n) => {
        if (n === 2) throw new Error('part 2');
        done.push(n);
      }),
    ).rejects.toThrow('part 2');
    expect(done).not.toContain(2);
  });

  it('does nothing on an empty list', async () => {
    await expect(runPool([], 4, () => Promise.reject(new Error('jamais')))).resolves.toBeUndefined();
  });
});

describe('throwIfAborted', () => {
  it('lets an absent or intact signal pass, throws otherwise', () => {
    expect(() => throwIfAborted()).not.toThrow();
    const ctrl = new AbortController();
    expect(() => throwIfAborted(ctrl.signal)).not.toThrow();
    ctrl.abort();
    expect(() => throwIfAborted(ctrl.signal)).toThrow();
  });
});
