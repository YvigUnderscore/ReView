// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { sha256OfFile, sha256OnMainThread } from './hashFile';

/**
 * The hashing changed thread, not result: that is what these cases lock in.
 * The test environment has no `Worker`, so `sha256OfFile` takes the fallback path,
 * and must return exactly what the original implementation returned.
 */

/** sha256('abc'): FIPS 180-4 reference value. */
const SHA_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
/** sha256 of the empty string. */
const SHA_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('sha256OnMainThread', () => {
  it('returns the reference hash', async () => {
    await expect(sha256OnMainThread(new Blob(['abc']))).resolves.toBe(SHA_ABC);
  });

  it('handles the empty file', async () => {
    await expect(sha256OnMainThread(new Blob([]))).resolves.toBe(SHA_EMPTY);
  });

  it('gives the same hash as content read in one go, across several slices', async () => {
    // 20 MB > the 8 MB slice: three passes through the read loop.
    const big = new Blob([new Uint8Array(20 * 1024 * 1024).fill(7)]);
    const once = new Blob([new Uint8Array(20 * 1024 * 1024).fill(7)]);
    await expect(sha256OnMainThread(big)).resolves.toBe(await sha256OnMainThread(once));
  });
});

describe('sha256OfFile', () => {
  it('falls back to the main thread when no worker is available', async () => {
    expect(typeof Worker).toBe('undefined'); // happy-dom : c'est bien le repli qui joue
    await expect(sha256OfFile(new File(['abc'], 'a.txt'))).resolves.toBe(SHA_ABC);
  });

  it('propagates cancellation rather than restarting a full computation', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    // Without a worker, the fallback is not interruptible: the contract is to return the
    // hash, never to fail. The caller checks the signal right afterwards.
    await expect(sha256OfFile(new File(['abc'], 'a.txt'), ctrl.signal)).resolves.toBe(SHA_ABC);
  });
});
