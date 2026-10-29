// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';
import { toast } from 'sonner';
import { t } from '../v2/i18n';
import { api } from '../lib/apiClient';
import { detectSequences, type FileSequence } from '../lib/imageSequence';
import { uploadImageSequence } from '../lib/sequenceUpload';
import { useUploadStore } from './useUploadStore';

/**
 * Drop of a batch of files: propose the grouping, then send it.
 *
 * Two distinct steps. `planDrop` recognizes the image sequences and opens the
 * proposal; nothing is created while the user has not decided. An imposed grouping made
 * silently would produce a media nobody wanted. When no pattern is recognized, it steps aside and returns the drop as is, without a dialog. `sendPlan` then sends
 * the chosen plan into a version: sequences in their own queue, the rest in the
 * ordinary one.
 * file ordinaire (`useUploadStore`).
 *
 * The separation exists for the version: it is only created AFTER the decision (and the
 * instruction, see `deliverFiles`), otherwise giving up on the dialog would leave an empty version.
 *
 * Sequences have their own queue because they have neither the same granularity
 * ("342 / 1200 frames") nor the same cost: only one at a time, each already parallelizing its
 * frames.
 */

export type SequenceUploadStatus = 'pending' | 'uploading' | 'processing' | 'done' | 'error';

export interface SequenceUploadItem {
  id: string;
  /** Naming pattern, shown as is: that is how the artist names the shot. */
  pattern: string;
  versionId: number;
  totalFrames: number;
  framesDone: number;
  progress: number;
  status: SequenceUploadStatus;
  mediaObjectId?: number;
  error?: string;
}

/** What a drop will become: sequences (one media each) and isolated files. */
export interface DropPlan {
  sequences: FileSequence[];
  singles: File[];
}

/** Drop awaiting a decision: what reading the names recognized. */
export interface SequenceProposal extends DropPlan {
  /** Hands control back to the drop: the chosen plan, or `null` if abandoned. */
  resolve: (plan: DropPlan | null) => void;
}

const POLL_MS = 3000;
/** Beyond this, we stop tracking: the assembly has a problem that the poll will not report. */
const POLL_MAX_MS = 60 * 60_000;

/** One sequence at a time: each already saturates the link with its four frames at once. */
const MAX_CONCURRENT_SEQUENCES = 1;

/** Files stay out of the store: a `File` has no business in the rendered state. */
interface QueuedSequence {
  sequence: FileSequence;
  versionId: number;
  note: string | null;
}
const queued = new Map<string, QueuedSequence>();
const controllers = new Map<string, AbortController>();

interface SequenceUploadState {
  proposal: SequenceProposal | null;
  uploads: SequenceUploadItem[];
  /** Keeps as sequences those that are ticked, and as files everything else. */
  acceptProposal: (grouped: FileSequence[]) => void;
  cancelProposal: () => void;
  removeUpload: (id: string) => void;
  clearCompleted: () => void;
}

export const useSequenceUploadStore = create<SequenceUploadState>((set, get) => ({
  proposal: null,
  uploads: [],

  acceptProposal: (grouped) => {
    const proposal = get().proposal;
    set({ proposal: null });
    if (!proposal) return;
    const kept = new Set(grouped.map((s) => s.pattern));
    const loose = proposal.sequences.filter((s) => !kept.has(s.pattern)).flatMap((s) => s.files);
    proposal.resolve({ sequences: grouped, singles: [...proposal.singles, ...loose] });
  },

  cancelProposal: () => {
    const proposal = get().proposal;
    set({ proposal: null });
    proposal?.resolve(null);
  },

  removeUpload: (id) => {
    controllers.get(id)?.abort();
    controllers.delete(id);
    queued.delete(id);
    set((s) => ({ uploads: s.uploads.filter((u) => u.id !== id) }));
    pump(set, get);
  },

  clearCompleted: () => set((s) => ({ uploads: s.uploads.filter((u) => u.status !== 'done') })),
}));

/**
 * Reads a drop and, if it contains sequences, asks for the grouping.
 *
 * Returns the chosen plan, or `null` if the user gives up. Without a recognized pattern, the drop
 * goes straight out as is: the ordinary path gains no screen.
 */
export function planDrop(files: File[]): Promise<DropPlan | null> {
  const { sequences, singles } = detectSequences(files);
  if (sequences.length === 0) return Promise.resolve({ sequences: [], singles: files });
  // A drop arriving while another awaits its decision replaces it: the old one is
  // explicitly abandoned rather than left suspended forever.
  useSequenceUploadStore.getState().cancelProposal();
  return new Promise((resolve) => {
    useSequenceUploadStore.setState({ proposal: { sequences, singles, resolve } });
  });
}

/** Sends a plan into a version, the upload instruction accompanying each media. */
export function sendPlan(plan: DropPlan, versionId: number, note: string | null): void {
  const { enqueue } = useUploadStore.getState();
  for (const file of plan.singles) enqueue(file, versionId, { note });
  const set = useSequenceUploadStore.setState;
  for (const sequence of plan.sequences) {
    const id = crypto.randomUUID();
    queued.set(id, { sequence, versionId, note });
    set((s) => ({
      uploads: [
        ...s.uploads,
        {
          id,
          pattern: sequence.pattern,
          versionId,
          totalFrames: sequence.frameCount,
          framesDone: 0,
          progress: 0,
          status: 'pending' as const,
        },
      ],
    }));
  }
  pump(set, useSequenceUploadStore.getState);
}

type Setter = (fn: (state: SequenceUploadState) => Partial<SequenceUploadState>) => void;

const patch = (set: Setter, id: string, changes: Partial<SequenceUploadItem>): void =>
  set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, ...changes } : u)) }));

/** Starts the pending sends as long as a slot is free. */
function pump(set: Setter, get: () => SequenceUploadState): void {
  const { uploads } = get();
  let running = uploads.filter((u) => u.status === 'uploading').length;
  for (const item of uploads) {
    if (running >= MAX_CONCURRENT_SEQUENCES) return;
    if (item.status !== 'pending') continue;
    const job = queued.get(item.id);
    if (!job) continue;
    queued.delete(item.id);
    running += 1;
    void startSequence(item.id, job, set, get);
  }
}

async function startSequence(
  id: string,
  job: QueuedSequence,
  set: Setter,
  get: () => SequenceUploadState,
): Promise<void> {
  const controller = new AbortController();
  controllers.set(id, controller);
  patch(set, id, { status: 'uploading' });
  try {
    const res = await uploadImageSequence(job.sequence, job.versionId, {
      signal: controller.signal,
      note: job.note,
      onProgress: (p) => patch(set, id, { progress: p.percent, framesDone: p.files }),
    });
    // A gappy delivery is not an error, but it should be said: it is the kind of
    // oversight an artist wants to know about before the review, not during.
    if (res.missingFrames > 0) toast.warning(t('imageSequence.gaps', { count: res.missingFrames }));
    patch(set, id, {
      status: 'processing',
      progress: 100,
      framesDone: res.frameCount,
      mediaObjectId: res.mediaObjectId,
    });
    followProcessing(id, res.mediaObjectId, set, get);
  } catch (err) {
    if (!controller.signal.aborted) {
      patch(set, id, {
        status: 'error',
        error: err instanceof Error ? err.message : t('uploads.error.generic'),
      });
    }
  } finally {
    controllers.delete(id);
    pump(set, get);
  }
}

/** Light poll until READY/FAILED: the assembly of a long shot takes minutes. */
function followProcessing(
  id: string,
  mediaObjectId: number,
  set: Setter,
  get: () => SequenceUploadState,
): void {
  const startedAt = Date.now();
  const tick = async (): Promise<void> => {
    const item = get().uploads.find((u) => u.id === id);
    if (!item || item.status !== 'processing') return;
    if (Date.now() - startedAt > POLL_MAX_MS) {
      patch(set, id, { status: 'error', error: t('uploads.error.processingTimeout') });
      return;
    }
    try {
      const { media } = await api.get<{ media: { status: string } }>(`/api/media/${mediaObjectId}`);
      if (media.status === 'READY') return patch(set, id, { status: 'done' });
      if (media.status === 'FAILED')
        return patch(set, id, { status: 'error', error: t('uploads.error.processingFailed') });
    } catch {
      // Transient outage: we will retry at the next tick.
    }
    window.setTimeout(() => void tick(), POLL_MS);
  };
  window.setTimeout(() => void tick(), POLL_MS);
}
