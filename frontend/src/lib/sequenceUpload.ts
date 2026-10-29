// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api, getToken } from './apiClient';
import { t } from '../v2/i18n';
import { isAbortError, putWithProgress, runPool, throwIfAborted, withRetry } from './uploadTransfer';
import type { FileSequence } from './imageSequence';

/**
 * Sending an image sequence: N files, ONE media.
 *
 * Resumable multipart splits a file into parts; here it is the reverse. The three
 * gains of the upload engine are replayed at frame scale: bounded parallelism,
 * retry with re-signing, real cancellation. The resume, for its part, costs the client nothing:
 * `init` returns the frames already in storage, which are simply skipped.
 *
 * Progress is dual, and deliberately so: "342 / 1200 frames" tells the artist where
 * they stand far better than a byte percentage, but the frames are not all the same
 * size, so we count the bytes for the bar and the files for the text.
 */

/** Frames sent at once. Same trade-off as the parts of a large file. */
const FRAME_CONCURRENCY = 4;
/** URLs requested per batch (the server caps it at 64). */
const FRAME_URL_BATCH = 32;

export interface SequenceProgress {
  /** Bytes transferred, including frames already present. */
  bytes: number;
  totalBytes: number;
  percent: number;
  files: number;
  totalFiles: number;
}

export interface SequenceUploadOptions {
  onProgress?: (progress: SequenceProgress) => void;
  signal?: AbortSignal;
  /** Imposed frame rate; otherwise inherited from the shot's pipeline on the server. */
  framerate?: number;
  /**
   * Upload instruction (Phase 50). Carried by the finalization, as for a single
   * file: a project that requires it refuses the sequence that arrives without it.
   */
  note?: string | null;
}

export interface SequenceUploadResult {
  mediaObjectId: number;
  status: string;
  frameCount: number;
  /** Missing numbers between the first and the last frame received. */
  missingFrames: number;
}

interface InitResponse {
  mediaObjectId: number;
  resumed: boolean;
  framerate: number;
  uploadedFrames: string[];
  namingWarning?: boolean;
}

interface CompleteResponse {
  media: { id: number; status: string };
  frameCount: number;
  missingFrames: number;
}

export async function uploadImageSequence(
  sequence: FileSequence,
  versionId: number,
  opts: SequenceUploadOptions = {},
): Promise<SequenceUploadResult> {
  if (!getToken()) throw new Error(t('uploads.error.notAuthenticated'));
  const { signal } = opts;
  throwIfAborted(signal);

  const init = await api.post<InitResponse>('/api/media/sequence/init', {
    versionId,
    pattern: sequence.pattern,
    frames: sequence.files.map((f) => ({ name: f.name, size: f.size })),
    ...(opts.framerate ? { framerate: opts.framerate } : {}),
  });

  try {
    await sendFrames(sequence, init, opts);
    throwIfAborted(signal);
    const done = await api.post<CompleteResponse>(`/api/media/sequence/${init.mediaObjectId}/complete`, {
      note: opts.note ?? null,
    });
    return {
      mediaObjectId: init.mediaObjectId,
      status: done.media.status,
      frameCount: done.frameCount,
      missingFrames: done.missingFrames,
    };
  } catch (err) {
    // Abort: the frames already dropped would be billed and invisible. The cancel route
    // empties the prefix and deletes the media left in UPLOADING.
    if (isAbortError(err) || signal?.aborted) {
      void api.post(`/api/media/multipart/${init.mediaObjectId}/abort`).catch(() => undefined);
    }
    throw err;
  }
}

/** Sends the missing frames; those already in place count toward progress. */
async function sendFrames(
  sequence: FileSequence,
  init: InitResponse,
  opts: SequenceUploadOptions,
): Promise<void> {
  const { signal, onProgress } = opts;
  const already = new Set(init.uploadedFrames);
  const totalBytes = sequence.totalSize;
  const totalFiles = sequence.files.length;
  const missing = sequence.files.filter((f) => !already.has(f.name));

  let sent = sequence.files.filter((f) => already.has(f.name)).reduce((acc, f) => acc + f.size, 0);
  let files = totalFiles - missing.length;
  const inFlight = new Map<string, number>();
  const emit = (): void => {
    let extra = 0;
    for (const loaded of inFlight.values()) extra += loaded;
    onProgress?.({
      bytes: sent + extra,
      totalBytes,
      percent: totalBytes > 0 ? Math.min(99, Math.round(((sent + extra) / totalBytes) * 100)) : 0,
      files,
      totalFiles,
    });
  };
  emit();

  for (let i = 0; i < missing.length; i += FRAME_URL_BATCH) {
    throwIfAborted(signal);
    const batch = missing.slice(i, i + FRAME_URL_BATCH);
    const urls = await frameUrls(
      init.mediaObjectId,
      batch.map((f) => f.name),
    );
    await runPool(batch, FRAME_CONCURRENCY, async (file) => {
      await sendFrame(init.mediaObjectId, file, urls.get(file.name) ?? '', inFlight, emit, signal);
      sent += file.size;
      files += 1;
      emit();
    });
  }
}

async function frameUrls(mediaObjectId: number, names: string[]): Promise<Map<string, string>> {
  const { urls } = await api.post<{ urls: { name: string; url: string }[] }>(
    `/api/media/sequence/${mediaObjectId}/urls`,
    { names },
  );
  return new Map(urls.map((u) => [u.name, u.url]));
}

/** One frame, with retry: each new attempt starts from a fresh signature. */
async function sendFrame(
  mediaObjectId: number,
  file: File,
  url: string,
  inFlight: Map<string, number>,
  emit: () => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await withRetry(async (tryIndex) => {
      const target =
        tryIndex === 0 ? url : ((await frameUrls(mediaObjectId, [file.name])).get(file.name) ?? url);
      inFlight.set(file.name, 0);
      // No Content-Type: the server sets it itself at finalization, and the
      // S3 signature does not cover it.
      await putWithProgress(
        target,
        file,
        null,
        (loaded) => {
          inFlight.set(file.name, loaded);
          emit();
        },
        signal,
      );
    }, signal);
  } finally {
    inFlight.delete(file.name);
  }
}
