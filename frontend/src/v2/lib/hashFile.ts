// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Sha256Request, Sha256Response } from './sha256.worker';

/**
 * sha256 of a file, off the main thread when possible.
 *
 * The hash serves the end-to-end checksum and deduplication (37.B): it must be
 * computed before upload, but nothing requires computing it *on the thread that draws*.
 * A single worker, created on first request and reused, carries the computation; if it
 * is unavailable (test environment, worker refused, unreadable module), the
 * historical fallback on the main thread takes over: the upload never fails.
 * for lack of a worker.
 */

/** Read slice size, identical on the worker side and the fallback side. */
const HASH_CHUNK = 8 * 1024 * 1024;

/**
 * sha256 hex computed on the calling thread: fallback, and reference implementation.
 *
 * `hash-wasm` is loaded here and nowhere else (F15): at module top level it went
 * into the entry file: 7.6 kB gzipped, downloaded by anyone who opened the application,
 * including reviewers who will never upload anything. The normal computation, for its part,
 * takes place in `sha256.worker.ts`, which has its own bundle. This path only serves
 * environments without `Worker`.
 */
export async function sha256OnMainThread(blob: Blob): Promise<string> {
  const { createSHA256 } = await import('hash-wasm');
  const hasher = await createSHA256();
  for (let off = 0; off < blob.size; off += HASH_CHUNK) {
    const buf = await blob.slice(off, off + HASH_CHUNK).arrayBuffer();
    hasher.update(new Uint8Array(buf));
  }
  return hasher.digest('hex');
}

/** `undefined` = not attempted yet, `null` = permanently unavailable. */
let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (hash: string) => void; reject: (err: Error) => void }>();

/** Abandons the worker and fails the pending requests: the caller will fall back. */
function giveUpWorker(reason: string): void {
  worker?.terminate();
  worker = null;
  for (const [, waiter] of pending) waiter.reject(new Error(reason));
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  // happy-dom (tests) and contexts without a worker: we do not even try.
  if (typeof Worker === 'undefined') {
    worker = null;
    return null;
  }
  try {
    const created = new Worker(new URL('./sha256.worker.ts', import.meta.url), { type: 'module' });
    created.addEventListener('message', (event: MessageEvent<Sha256Response>) => {
      const waiter = pending.get(event.data.id);
      if (!waiter) return; // demande abandonnée entre-temps (upload annulé)
      pending.delete(event.data.id);
      if ('hash' in event.data) waiter.resolve(event.data.hash);
      else waiter.reject(new Error(event.data.error));
    });
    created.addEventListener('error', () => giveUpWorker('sha256 worker error'));
    worker = created;
  } catch {
    worker = null;
  }
  return worker;
}

function hashInWorker(w: Worker, blob: Blob, signal?: AbortSignal): Promise<string> {
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Cancellation: we stop waiting. The worker will finish its computation into the void,
    // its reply will find no requester: cheaper than recreating it.
    signal?.addEventListener(
      'abort',
      () => {
        pending.delete(id);
        reject(new Error('aborted'));
      },
      { once: true },
    );
    const message: Sha256Request = { id, blob };
    w.postMessage(message);
  });
}

/**
 * sha256 hex of the file. Uses the worker if possible, otherwise the main thread.
 * `signal` interrupts the wait (the fallback, for its part, stops at the next slice).
 */
export async function sha256OfFile(file: Blob, signal?: AbortSignal): Promise<string> {
  const w = getWorker();
  if (w) {
    try {
      return await hashInWorker(w, file, signal);
    } catch (err) {
      // Cancellation requested: do not restart a full computation on the main thread.
      if (signal?.aborted) throw err;
    }
  }
  return sha256OnMainThread(file);
}
