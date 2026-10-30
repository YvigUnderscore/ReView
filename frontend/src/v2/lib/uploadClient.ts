// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api, getToken } from '../../lib/apiClient';
import { t } from '../i18n';
import { sha256OfFile } from './hashFile';
import { isAbortError, putWithProgress, runPool, throwIfAborted, withRetry } from './uploadTransfer';
import type { MediaKind } from '../types/api';

// `.usd` (generic container, binary or ASCII) was missing: it only arrived as MODEL_3D through
// the fallback of `inferMediaKind`, hence never from a file picker filter (45.F).
const MODEL_EXT = [
  '.glb',
  '.gltf',
  '.fbx',
  '.usd',
  '.usdz',
  '.usdc',
  '.usda',
  '.obj',
  '.dae',
  '.stl',
  '.zip',
];
// Gaussian Splat (Spark/SparkJS viewer): see detectSplat on the backend.
const SPLAT_EXT = ['.ply', '.splat', '.spz', '.ksplat', '.sog', '.sogs'];

/** Above this threshold: resumable multipart (37.A). The part size comes from the server. */
const MULTIPART_THRESHOLD = 16 * 1024 * 1024;
/** Part URLs requested in batches (capped server-side at 64). */
const PART_URL_BATCH = 32;
/**
 * Parts sent at once. S3 accepts more, but four connections already saturate
 * a studio link while leaving the interface (and the other tabs) room to breathe.
 */
const PART_CONCURRENCY = 4;

/** Infers the MediaKind of a file from its MIME type / extension. */
export function inferMediaKind(file: File): MediaKind {
  const name = file.name.toLowerCase();
  const ext = name.slice(name.lastIndexOf('.'));
  if (SPLAT_EXT.includes(ext)) return 'SPLAT';
  if (MODEL_EXT.includes(ext)) return 'MODEL_3D';
  if (file.type.startsWith('video/')) return 'VIDEO';
  if (file.type.startsWith('image/')) return 'IMAGE';
  return 'MODEL_3D';
}

export interface UploadResult {
  mediaObjectId: number;
  status: string;
  /** Identical content already present: no byte transferred (37.B). */
  deduplicated?: boolean;
  /** Name not compliant with the project nomenclature in "warn" mode (38.C). */
  namingWarning?: boolean;
}

interface MultipartInit {
  mediaObjectId: number;
  partSize: number;
  uploadedParts: { partNumber: number; etag: string }[];
  deduplicated?: boolean;
  resumed?: boolean;
  namingWarning?: boolean;
}

export interface UploadOptions {
  kind?: MediaKind;
  onProgress?: (pct: number) => void;
  /** Cancellation: cuts in-flight requests and abandons the multipart on the server. */
  signal?: AbortSignal;
  /**
   * Instruction required by the project (`reviewRequest.requireNote`), collected BEFORE the upload
   * since Phase 50: a media is published as soon as it is dropped, there is no longer a
   * publishing step where it could be requested.
   *
   * **Single connection point**: it is only sent at `finalize`, under the `note` field. If the
   * server expects another field name or another call, this is the only line to change.
   */
  note?: string | null;
}

/** Calls back the caller only when the percentage really changes (4 parts = 4x the events). */
function throttlePercent(onProgress?: (pct: number) => void): (pct: number) => void {
  let last = -1;
  return (pct) => {
    if (pct === last) return;
    last = pct;
    onProgress?.(pct);
  };
}

/**
 * v2 upload flow (37.A/37.B):
 *  1) sha256 of the file (end-to-end checksum + dedup), computed in a worker;
 *  2) small files go to a direct presigned PUT; large ones to resumable multipart, parts sent
 *     in parallel with retry (the resume skips the parts already received, known from the
 *     server via ListParts);
 *  3) finalize: magic-byte validation and processing.
 *
 * `opts.signal` cancels at any step: the in-flight request is cut, and the upload
 * left-over multipart is explicitly abandoned on the server side.
 */
export async function uploadMedia(
  file: File,
  versionId: number,
  opts: UploadOptions = {},
): Promise<UploadResult> {
  if (!getToken()) throw new Error(t('uploads.error.notAuthenticated'));
  const { signal } = opts;
  const kind = opts.kind ?? inferMediaKind(file);
  const report = throttlePercent(opts.onProgress);
  const contentType = file.type || 'application/octet-stream';
  throwIfAborted(signal);
  const contentHash = await sha256OfFile(file, signal).catch(() => undefined);
  throwIfAborted(signal);
  const base = { versionId, filename: file.name, contentType, kind, size: file.size, contentHash };

  // Recorded as soon as the server creates it: an abort *during* the upload must
  // still know which media to free.
  let mediaObjectId: number | undefined;
  const remember = (id: number): void => {
    mediaObjectId = id;
  };
  try {
    const namingWarning =
      file.size < MULTIPART_THRESHOLD
        ? await uploadSmall(file, base, contentType, report, remember, signal)
        : await uploadLarge(file, base, report, remember, signal);
    report(100);
    throwIfAborted(signal);
    const finalize = `/api/media/${mediaObjectId!}/finalize`;
    // Without an instruction, the request stays bare: it is the body that instances requiring
    // nothing expect, and the one the API contract has described since forever.
    const { media } = await (opts.note == null
      ? api.post<{ media: { status: string } }>(finalize)
      : api.post<{ media: { status: string } }>(finalize, { note: opts.note }));
    return { mediaObjectId: mediaObjectId!, status: media.status, namingWarning };
  } catch (err) {
    // Abort: free the parts already dropped rather than leaving them billed.
    if (mediaObjectId !== undefined && (isAbortError(err) || signal?.aborted)) {
      void api.post(`/api/media/multipart/${mediaObjectId}/abort`).catch(() => undefined);
    }
    throw err;
  }
}

type InitBody = Record<string, unknown>;

/** Small file: a single presigned PUT, nothing to resume. */
async function uploadSmall(
  file: File,
  base: InitBody,
  contentType: string,
  report: (pct: number) => void,
  remember: (id: number) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const created = await api.post<{
    mediaObjectId: number;
    uploadUrl: string;
    namingWarning?: boolean;
  }>('/api/media/upload-url', base);
  remember(created.mediaObjectId);
  await withRetry(
    () =>
      putWithProgress(
        created.uploadUrl,
        file,
        contentType,
        (loaded) => report(Math.min(99, Math.round((loaded / file.size) * 100))),
        signal,
      ),
    signal,
  );
  return created.namingWarning ?? false;
}

/** Large file: resumable multipart, parts parallelized. */
async function uploadLarge(
  file: File,
  base: InitBody,
  report: (pct: number) => void,
  remember: (id: number) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const init = await api.post<MultipartInit>('/api/media/multipart/init', base);
  remember(init.mediaObjectId);
  if (!init.deduplicated) {
    await uploadParts(file, init, report, signal);
    throwIfAborted(signal);
    await api.post(`/api/media/multipart/${init.mediaObjectId}/complete`, {
      parts: init.uploadedParts,
    });
  }
  return init.namingWarning ?? false;
}

/** Context shared by the parts of the same file (progress, cancellation). */
interface PartContext {
  file: File;
  mediaObjectId: number;
  partSize: number;
  /** Bytes already counted for each part in flight: the sum gives the real progress. */
  inFlight: Map<number, number>;
  emit: () => void;
  signal?: AbortSignal;
}

async function partUrls(mediaObjectId: number, partNumbers: number[]): Promise<Map<number, string>> {
  const { urls } = await api.post<{ urls: { partNumber: number; url: string }[] }>(
    `/api/media/multipart/${mediaObjectId}/parts`,
    { partNumbers },
  );
  return new Map(urls.map((u) => [u.partNumber, u.url]));
}

/** Sends a part, with retry: each new attempt starts from a fresh URL. */
async function sendPart(ctx: PartContext, partNumber: number, url: string): Promise<string> {
  const start = (partNumber - 1) * ctx.partSize;
  const blob = ctx.file.slice(start, Math.min(start + ctx.partSize, ctx.file.size));
  try {
    return await withRetry(async (tryIndex) => {
      // A part that failed may have done so on an expired signature (they live one
      // hour): re-signing it costs a round trip and makes the retry useful.
      const target =
        tryIndex === 0 ? url : ((await partUrls(ctx.mediaObjectId, [partNumber])).get(partNumber) ?? url);
      ctx.inFlight.set(partNumber, 0);
      // No Content-Type on the parts (the S3 signature does not cover it).
      const etag = await putWithProgress(
        target,
        blob,
        null,
        (loaded) => {
          ctx.inFlight.set(partNumber, loaded);
          ctx.emit();
        },
        ctx.signal,
      );
      if (!etag) throw new Error(t('uploads.error.missingEtag'));
      return etag.replaceAll('"', '');
    }, ctx.signal);
  } finally {
    ctx.inFlight.delete(partNumber);
  }
}

/** Sends the missing parts (those already received count toward progress). */
async function uploadParts(
  file: File,
  init: MultipartInit,
  report: (pct: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { partSize } = init;
  const totalParts = Math.ceil(file.size / partSize);
  const done = new Map(init.uploadedParts.map((p) => [p.partNumber, p.etag]));
  const sizeOf = (n: number) => Math.min(partSize, file.size - (n - 1) * partSize);
  let sent = [...done.keys()].reduce((acc, n) => acc + sizeOf(n), 0);
  const inFlight = new Map<number, number>();
  const emit = () => {
    let extra = 0;
    for (const loaded of inFlight.values()) extra += loaded;
    report(Math.min(99, Math.round(((sent + extra) / file.size) * 100)));
  };
  emit();

  const ctx: PartContext = { file, mediaObjectId: init.mediaObjectId, partSize, inFlight, emit, signal };
  const missing = Array.from({ length: totalParts }, (_, i) => i + 1).filter((n) => !done.has(n));
  for (let i = 0; i < missing.length; i += PART_URL_BATCH) {
    throwIfAborted(signal);
    const batch = missing.slice(i, i + PART_URL_BATCH);
    const urls = await partUrls(init.mediaObjectId, batch);
    await runPool(batch, PART_CONCURRENCY, async (partNumber) => {
      const etag = await sendPart(ctx, partNumber, urls.get(partNumber) ?? '');
      done.set(partNumber, etag);
      sent += sizeOf(partNumber);
      emit();
    });
  }
  // Sorted: parallelism and retries finish parts out of order, and a `complete`
  // that reads in file order is worth a lot the day it has to be reread.
  init.uploadedParts = [...done.entries()]
    .map(([partNumber, etag]) => ({ partNumber, etag }))
    .sort((a, b) => a.partNumber - b.partNumber);
}
