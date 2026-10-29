// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { t } from '../v2/i18n';
import { create } from 'zustand';
import { toast } from 'sonner';
import { uploadMedia, inferMediaKind } from '../lib/uploadClient';
import { api } from '../lib/apiClient';
import type { MediaKind } from '../v2/types/api';

/**
 * Global upload store (Zustand).
 *
 * Allows free navigation during an upload: the state lives here, outside the tree of
 * pages, and survives route changes. The flow delegates to `uploadClient`
 * (presigned URL → direct PUT to MinIO → finalize), so nothing blocks the UI thread.
 *
 * **Bounded queue (wave 2):** dropping thirty shots launched thirty transfers at once,
 * which competed for bandwidth and made the signatures of the last ones expire.
 * Three files go up at a time; the next ones wait for their slot in `pending`.
 * Each transfer carries an `AbortController`: removing a row really cuts the
 * in-flight request and abandons the multipart on the server.
 *
 * After finalize, if the media goes into processing (video transcoding, 3D conversion…),
 * the item moves to `processing` and the store **tracks the status** (light poll) until
 * READY/FAILED: the upload notification becomes a transcoding notification.
 */

export type UploadStatus = 'pending' | 'uploading' | 'finalizing' | 'processing' | 'done' | 'error';

export interface UploadItem {
  id: string;
  filename: string;
  versionId: number;
  kind: MediaKind;
  progress: number; // 0–100
  status: UploadStatus;
  mediaObjectId?: number;
  error?: string;
}

/** What a drop knows about itself, beyond the file and its version. */
export interface EnqueueOptions {
  kind?: MediaKind;
  /**
   * Instruction written before sending (Phase 50), when the project requires it. It travels to
   * `finalize`: that is the only moment when the server can refuse it before publishing.
   */
  note?: string | null;
}

const POLL_MS = 3000;
const POLL_MAX_MS = 20 * 60_000; // au-delà on abandonne le suivi (le worker a un souci)

/** Simultaneous transfers. Beyond that, connections hinder each other more than they help. */
const MAX_CONCURRENT_UPLOADS = 3;

/** Statuses that consume a transfer slot (server processing, for its part, is free). */
const isTransferring = (s: UploadStatus): boolean => s === 'uploading' || s === 'finalizing';

/** A transfer waiting for a slot, as `startUpload` will pick it up. */
interface QueuedJob {
  file: File;
  versionId: number;
  kind: MediaKind;
  note?: string | null;
}

/** Files waiting for a slot: outside the store, since a `File` has no business in the rendered state. */
const queued = new Map<string, QueuedJob>();
/** Cancellation of in-flight transfers, by item identifier. */
const controllers = new Map<string, AbortController>();

interface UploadState {
  uploads: UploadItem[];
  /** Queues a file (starts immediately if a slot is free). Returns the local id. */
  enqueue: (file: File, versionId: number, opts?: EnqueueOptions) => string;
  updateUpload: (id: string, patch: Partial<UploadItem>) => void;
  /** Removes the row, and really cancels the transfer if it is in progress. */
  removeUpload: (id: string) => void;
  clearCompleted: () => void;
  /** Number of uploads in progress (for badges/indicators). */
  activeCount: () => number;
}

export const useUploadStore = create<UploadState>((set, get) => ({
  uploads: [],

  enqueue: (file, versionId, opts) => {
    const id = crypto.randomUUID();
    const item: UploadItem = {
      id,
      filename: file.name,
      versionId,
      kind: opts?.kind ?? inferMediaKind(file),
      progress: 0,
      status: 'pending',
    };
    queued.set(id, { file, versionId, kind: item.kind, note: opts?.note ?? null });
    set((s) => ({ uploads: [...s.uploads, item] }));
    pump(get);
    return id;
  },

  updateUpload: (id, patch) =>
    set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) })),

  removeUpload: (id) => {
    controllers.get(id)?.abort();
    controllers.delete(id);
    queued.delete(id);
    set((s) => ({ uploads: s.uploads.filter((u) => u.id !== id) }));
    pump(get);
  },

  clearCompleted: () => set((s) => ({ uploads: s.uploads.filter((u) => u.status !== 'done') })),
  activeCount: () =>
    get().uploads.filter(
      (u) =>
        u.status === 'uploading' ||
        u.status === 'finalizing' ||
        u.status === 'processing' ||
        u.status === 'pending',
    ).length,
}));

/**
 * Starts the pending transfers as long as a slot is free. The count of active transfers is read
 * from the state rather than from a parallel counter: emptying the store (tests,
 * sign-out) therefore cannot leave the queue blocked on a ghost slot.
 */
function pump(get: () => UploadState): void {
  const { uploads } = get();
  let running = uploads.filter((u) => isTransferring(u.status)).length;
  for (const item of uploads) {
    if (running >= MAX_CONCURRENT_UPLOADS) return;
    if (item.status !== 'pending') continue;
    const job = queued.get(item.id);
    if (!job) continue;
    queued.delete(item.id);
    running += 1;
    void startUpload(item.id, job, get);
  }
}

async function startUpload(id: string, job: QueuedJob, get: () => UploadState): Promise<void> {
  const { updateUpload } = get();
  const controller = new AbortController();
  controllers.set(id, controller);
  updateUpload(id, { status: 'uploading' });
  try {
    const res = await uploadMedia(job.file, job.versionId, {
      kind: job.kind,
      note: job.note,
      signal: controller.signal,
      onProgress: (pct) =>
        updateUpload(id, { progress: pct, status: pct >= 100 ? 'finalizing' : 'uploading' }),
    });
    // Name not compliant with the project nomenclature in "warn" mode (38.C).
    if (res.namingWarning) toast.warning(t('naming.warningFile', { name: job.file.name }));
    if (res.status === 'PROCESSING') {
      // Server processing (transcoding/conversion): we follow it until READY.
      updateUpload(id, { status: 'processing', progress: 100, mediaObjectId: res.mediaObjectId });
      followProcessing(id, res.mediaObjectId, get);
    } else {
      updateUpload(id, { status: 'done', progress: 100, mediaObjectId: res.mediaObjectId });
    }
  } catch (err) {
    // Cancellation requested: the row has already disappeared, so there is no failure to report.
    if (!controller.signal.aborted) {
      updateUpload(id, {
        status: 'error',
        error: err instanceof Error ? err.message : t('uploads.error.generic'),
      });
    }
  } finally {
    controllers.delete(id);
    pump(get);
  }
}

/** Light poll of the media status until READY/FAILED (item removed from the store = stop). */
function followProcessing(id: string, mediaObjectId: number, get: () => UploadState) {
  const startedAt = Date.now();
  const tick = async () => {
    const item = get().uploads.find((u) => u.id === id);
    if (!item || item.status !== 'processing') return; // retiré ou terminé entre-temps
    if (Date.now() - startedAt > POLL_MAX_MS) {
      get().updateUpload(id, { status: 'error', error: t('uploads.error.processingTimeout') });
      return;
    }
    try {
      const { media } = await api.get<{ media: { status: string } }>(`/api/media/${mediaObjectId}`);
      if (media.status === 'READY') return get().updateUpload(id, { status: 'done' });
      if (media.status === 'FAILED')
        return get().updateUpload(id, { status: 'error', error: t('uploads.error.processingFailed') });
    } catch {
      // Transient network error: we will retry at the next tick.
    }
    window.setTimeout(() => void tick(), POLL_MS);
  };
  window.setTimeout(() => void tick(), POLL_MS);
}
