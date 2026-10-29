// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { t } from '../v2/i18n';

/**
 * Transfer primitives of the upload engine (wave 2).
 *
 * Three structural gaps of the original upload are handled here, apart from the business flow
 * of `uploadClient`:
 *  - **real cancellation**: an `AbortSignal` interrupts the in-flight request (`xhr.abort`),
 *    whereas "removing the row" let the transfer keep consuming bandwidth;
 *  - **per-part retry**: a cut on one part made 20 GB of upload fail; we
 *    retry three times with progressive waits, and re-sign the URL when the refusal
 *    looks like an expired signature (presigned URLs live one hour);
 *  - **bounded parallelism**: S3 accepts several parts at once, whereas a `for` loop
 *    used only a single connection.
 */

/** Cancellation requested by the user: neither a network failure nor to be retried. */
class UploadAbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'UploadAbortError';
  }
}

/** HTTP refusal from the storage: the status decides the retry and the re-signing. */
export class UploadHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(t('uploads.error.storage', { status }));
    this.name = 'UploadHttpError';
    this.status = status;
  }
}

export const isAbortError = (err: unknown): boolean => err instanceof UploadAbortError;

/** A definitive 4xx is not retried; everything else (network, 5xx, 408, 429) is. */
function isRetriable(err: unknown): boolean {
  if (isAbortError(err)) return false;
  if (err instanceof UploadHttpError && err.status >= 400 && err.status < 500) {
    return err.status === 401 || err.status === 403 || err.status === 408 || err.status === 429;
  }
  return true;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new UploadAbortError();
}

/** Interruptible wait: an abort must not wait out the whole backoff. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // Signal already triggered: `addEventListener('abort')` would not replay, and the
    // backoff would elapse in full after a cancellation.
    if (signal?.aborted) return reject(new UploadAbortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new UploadAbortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** XHR PUT with progress and cancellation; returns the ETag (multipart), or null if absent. */
export function putWithProgress(
  url: string,
  body: Blob,
  contentType: string | null,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new UploadAbortError());
    const xhr = new XMLHttpRequest();
    const onAbort = (): void => xhr.abort();
    const settle = (fn: () => void): void => {
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    xhr.open('PUT', url);
    if (contentType) xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () =>
      settle(() =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve(xhr.getResponseHeader('ETag'))
          : reject(new UploadHttpError(xhr.status)),
      );
    xhr.onerror = () => settle(() => reject(new Error(t('uploads.error.network'))));
    xhr.onabort = () => settle(() => reject(new UploadAbortError()));
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(body);
  });
}

/** Waits between two attempts: three retries, increasingly spaced. */
export const RETRY_DELAYS = [500, 1500, 4000];

/**
 * Replays `attempt` until the waits are exhausted. The attempt number is passed to
 * the caller so that it can, for example, request a new presigned URL.
 */
export async function withRetry<T>(
  attempt: (tryIndex: number) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= RETRY_DELAYS.length; i++) {
    throwIfAborted(signal);
    try {
      return await attempt(i);
    } catch (err) {
      if (!isRetriable(err) || i === RETRY_DELAYS.length) throw err;
      last = err;
      await wait(RETRY_DELAYS[i], signal);
    }
  }
  throw last; // inatteignable : la dernière tentative relance son propre échec
}

/**
 * Runs `task` on each item with at most `limit` tasks at once, and stops
 * at the first error (tasks already started run to completion, none is orphaned).
 */
export async function runPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  const lane = async (): Promise<void> => {
    while (!failed) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await task(items[index]);
      } catch (err) {
        failed = true;
        failure = err;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (failed) throw failure;
}
