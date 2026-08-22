// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isAbortError, putWithProgress, runPool, throwIfAborted, withRetry } from './uploadTransfer';

/**
 * Les trois manques du moteur d'upload se vérifient ici : couper un transfert en vol,
 * réessayer une part sans perdre les autres, et n'en envoyer qu'un nombre borné de front.
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
  it('rend l’ETag de la part et relaie la progression', async () => {
    const seen: number[] = [];
    const p = putWithProgress('https://s3/part1', blob, null, (loaded) => seen.push(loaded));
    last().upload.onprogress?.({ lengthComputable: true, loaded: 2 });
    last().onload?.();
    await expect(p).resolves.toBe('"deadbeef"');
    expect(seen).toEqual([2]);
  });

  it('rejette sur refus HTTP, sans confondre avec une annulation', async () => {
    const p = putWithProgress('https://s3/part1', blob, null, () => {});
    last().status = 503;
    last().onload?.();
    await expect(p).rejects.toThrow();
    await p.catch((err: unknown) => expect(isAbortError(err)).toBe(false));
  });

  it('coupe la requête en vol quand le signal est déclenché', async () => {
    const ctrl = new AbortController();
    const p = putWithProgress('https://s3/part1', blob, null, () => {}, ctrl.signal);
    const xhr = last();
    ctrl.abort();
    expect(xhr.aborted).toBe(true);
    await p.catch((err: unknown) => expect(isAbortError(err)).toBe(true));
  });

  it('refuse de partir si le signal est déjà déclenché (aucun octet envoyé)', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await putWithProgress('https://s3/part1', blob, null, () => {}, ctrl.signal).catch((err: unknown) =>
      expect(isAbortError(err)).toBe(true),
    );
    expect(FakeXhr.instances).toHaveLength(0);
  });
});

describe('withRetry', () => {
  it('réessaie une part en échec et finit par réussir', async () => {
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

  it('abandonne après le dernier réessai en relançant l’erreur d’origine', async () => {
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

  it('ne réessaie pas une annulation : l’attente est coupée net', async () => {
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
  it('n’exécute jamais plus de tâches que la limite', async () => {
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

  it('remonte la première erreur sans laisser de promesse orpheline', async () => {
    const done: number[] = [];
    await expect(
      runPool([1, 2, 3, 4], 2, async (n) => {
        if (n === 2) throw new Error('part 2');
        done.push(n);
      }),
    ).rejects.toThrow('part 2');
    expect(done).not.toContain(2);
  });

  it('ne fait rien sur une liste vide', async () => {
    await expect(runPool([], 4, () => Promise.reject(new Error('jamais')))).resolves.toBeUndefined();
  });
});

describe('throwIfAborted', () => {
  it('laisse passer un signal absent ou intact, jette sinon', () => {
    expect(() => throwIfAborted()).not.toThrow();
    const ctrl = new AbortController();
    expect(() => throwIfAborted(ctrl.signal)).not.toThrow();
    ctrl.abort();
    expect(() => throwIfAborted(ctrl.signal)).toThrow();
  });
});
