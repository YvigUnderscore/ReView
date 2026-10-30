// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { mediaQueue } from './queues';

/**
 * Reconciliation of media stuck in `PROCESSING`.
 *
 * A worker killed in the middle of a transcode loses its BullMQ lock. The first stall replays the job, but on the second
 * (`maxStalledCount: 1`) BullMQ fails it **outside the application path**: the media stays `PROCESSING`, without
 * `processingError`, indistinguishable from a job still running. No query swept this state — a media lost that way was
 * lost for good.
 *
 * Adopted policy: **explicit failure, never automatic re-queuing.**
 *  - The original job type (`transcode`/`thumbnail`/`convert3d`) cannot be reconstituted safely from the database;
 *    re-queuing it blindly would risk running the wrong job and overwriting valid derivatives.
 *  - A pathological file that makes the worker fail again would be re-queued at every restart, indefinitely.
 *  - `FAILED` + `processingError` is a **visible** state: review shows the reason, and the existing "reprocess" action
 *    re-queues the right job, on a human decision.
 *
 * Two safeguards before condemning a media: there must be **no live job** for it in the queue (waiting, active,
 * delayed...), and it must be old — a media just enqueued must not be caught by a sweep running faster than it.
 */

/** Minimum age before a `PROCESSING` media without a live job is deemed lost. */
export const MEDIA_STUCK_AFTER_MS = 15 * 60_000;

/** Delay before the start-up sweep: lets the worker connect to the queue. */
export const RECONCILE_BOOT_DELAY_MS = 20_000;

export type ReconcileAction = 'skip' | 'fail';

export interface StuckMediaCandidate {
  id: number;
  /** Age of the media (ms). */
  ageMs: number;
  /** A job concerning it still exists in the queue (waiting, active, delayed, prioritised...). */
  hasLiveJob: boolean;
}

/**
 * Decides the fate of a media left in `PROCESSING`. Pure function: it is this that carries the policy, and it is this
 * that is tested.
 */
export function reconcileAction(
  candidate: StuckMediaCandidate,
  stuckAfterMs: number = MEDIA_STUCK_AFTER_MS,
): ReconcileAction {
  if (candidate.hasLiveJob) return 'skip';
  if (candidate.ageMs < stuckAfterMs) return 'skip';
  return 'fail';
}

/** Message carried by `metadata.processingError` — in English, like all backend errors. */
export function reconcileFailureMessage(ageMs: number): string {
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  return `Processing was interrupted (worker restarted or job lost): the media stayed in PROCESSING for ${minutes} min with no live job. Relaunch processing from the media menu.`;
}

/** BullMQ states that protect a media: its processing is not lost, it waits its turn. */
const LIVE_JOB_TYPES = ['waiting', 'active', 'delayed', 'paused', 'prioritized', 'waiting-children'] as const;

/**
 * Ceiling of jobs read per state and per pass.
 *
 * `getJobs` without a range fetches **every** live job from Redis, payload included. As long as reconciliation only ran
 * at API start-up, nobody saw it; periodic, it would traverse the whole backlog at each maintenance pass. The range
 * bounds it. Two thousand per state leaves a considerable margin on a studio backlog (the media queue carries one job
 * per enqueued media, not one per segment).
 */
export const LIVE_JOB_SCAN_MAX = 2_000;

export interface LiveMediaJobs {
  /** Media still having a live job. */
  ids: Set<number>;
  /**
   * False as soon as the read reaches the ceiling. BullMQ applies the range state by state: one cannot distinguish, in
   * the flattened result, a saturated state from a sum of loaded states — so we do not distinguish, we abstain.
   * Believing "no job" on a possibly partial read would condemn a media whose processing is simply waiting its turn,
   * and that is irrecoverable: the media goes to FAILED under the artist's eyes.
   */
  complete: boolean;
}

/** Identifiers of media still having a live job in the processing queue. */
export async function liveMediaJobIds(): Promise<LiveMediaJobs> {
  // A single call: BullMQ reads the six states in one Lua script, so the snapshot stays consistent — a job going from
  // `waiting` to `active` cannot slip between two reads and vanish from the report.
  const jobs = await mediaQueue.getJobs([...LIVE_JOB_TYPES], 0, LIVE_JOB_SCAN_MAX - 1);
  const ids = new Set<number>();
  for (const job of jobs) {
    const id = job?.data?.mediaObjectId;
    if (typeof id === 'number') ids.add(id);
  }
  return { ids, complete: jobs.length < LIVE_JOB_SCAN_MAX };
}

/**
 * Sweeps `PROCESSING` media and condemns those no longer having a live job.
 * Returns the number of media moved to failure.
 */
export async function reconcileStuckMedia(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MEDIA_STUCK_AFTER_MS);
  const candidates = await prisma.mediaObject.findMany({
    where: { status: MediaStatus.PROCESSING, deletedAt: null, createdAt: { lt: cutoff } },
    select: { id: true, createdAt: true, metadata: true },
  });
  if (candidates.length === 0) return 0;

  const live = await liveMediaJobIds();
  if (!live.complete) {
    logger.warn(
      { scanned: candidates.length, max: LIVE_JOB_SCAN_MAX },
      '[reconcile] live job listing truncated: pass abandoned without failing any media',
    );
    return 0;
  }
  let failed = 0;
  for (const media of candidates) {
    const ageMs = now.getTime() - media.createdAt.getTime();
    if (reconcileAction({ id: media.id, ageMs, hasLiveJob: live.ids.has(media.id) }) !== 'fail') continue;
    const metadata: Record<string, unknown> = { ...((media.metadata ?? {}) as object) };
    metadata.processingError = reconcileFailureMessage(ageMs);
    // `updateMany` with the status as a condition: if the worker has just finished between the read and the write,
    // we do not demote a media that has become READY.
    const res = await prisma.mediaObject.updateMany({
      where: { id: media.id, status: MediaStatus.PROCESSING },
      data: { status: MediaStatus.FAILED, metadata: metadata as Prisma.InputJsonObject },
    });
    failed += res.count;
  }
  if (failed > 0)
    logger.warn(
      { failed, scanned: candidates.length },
      '[reconcile] media stuck in PROCESSING marked as failed',
    );
  return failed;
}
