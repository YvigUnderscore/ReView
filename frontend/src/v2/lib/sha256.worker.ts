// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSHA256 } from 'hash-wasm';

/**
 * sha256 hashing worker (wave 2: upload engine).
 *
 * The end-to-end checksum (37.B) ran on the main thread: a 20 GB master would
 * freeze the interface for tens of seconds **before** the first byte
 * left. The computation now lives here; the `Blob` crosses the worker boundary by
 * reference (no copy of the bytes), and only the hexadecimal result comes back.
 *
 * The protocol is deliberately minimal: a request carries an identifier, and the
 * reply returns it, so a single worker serves several files in parallel.
 */

/** Hashing request: a blob to read, an identifier to return as is. */
export interface Sha256Request {
  id: number;
  blob: Blob;
}

/** Reply: the hexadecimal hash, or the reason for the failure. */
export type Sha256Response = { id: number; hash: string } | { id: number; error: string };

/** Read slice size: a trade-off between memory and the number of round trips. */
const CHUNK = 8 * 1024 * 1024;

/**
 * Worker context. `lib` does not contain `WebWorker` (tsconfig targeting the DOM): we
 * describe here the surface actually used rather than widening the configuration.
 */
const ctx = self as unknown as {
  addEventListener(type: 'message', fn: (event: MessageEvent<Sha256Request>) => void): void;
  postMessage(message: Sha256Response): void;
};

async function hash(blob: Blob): Promise<string> {
  const hasher = await createSHA256();
  for (let off = 0; off < blob.size; off += CHUNK) {
    const buf = await blob.slice(off, off + CHUNK).arrayBuffer();
    hasher.update(new Uint8Array(buf));
  }
  return hasher.digest('hex');
}

ctx.addEventListener('message', (event) => {
  const { id, blob } = event.data;
  void hash(blob).then(
    (value) => ctx.postMessage({ id, hash: value }),
    (err: unknown) => ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) }),
  );
});
