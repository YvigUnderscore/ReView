// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Maximum delays of an ffmpeg / ffprobe invocation.
 *
 * An ffmpeg command that loops (exotic container, corrupted stream, filter that no longer progresses)
 * blocks **permanently** one of the two slots of the `media-processing` queue: two such files halt all of
 * the studio's transcoding, and nothing signals it. Each invocation therefore gets a bounded delay,
 * proportional to the probed duration of the media when known; past the delay, the process is killed and
 * the job fails with a message naming the step and the limit exceeded.
 *
 * The bounds are deliberately wide: the goal is to catch a hang, not to cut a slow encode. A ten-minute 4K
 * in libx264 runs at about 10× real time; the chosen factor leaves twice that margin.
 */

/** ffprobe probe: reads headers, never a long job. */
export const FFPROBE_TIMEOUT_MS = 60_000;

/** Floor: covers tiny files whose cost is dominated by I/O. */
export const FFMPEG_MIN_TIMEOUT_MS = 5 * 60_000;

/** Absolute ceiling: beyond it, it is a hang, not an encode. */
export const FFMPEG_MAX_TIMEOUT_MS = 6 * 60 * 60_000;

/** Multiple of real time granted to an encoding pass. */
export const FFMPEG_REALTIME_FACTOR = 20;

/** Unknown duration (silent ffprobe, synthetic input): a one-hour flat rate. */
export const FFMPEG_UNKNOWN_TIMEOUT_MS = 60 * 60_000;

export interface FfmpegTimeoutOptions {
  /** Multiple of real time granted (default: {@link FFMPEG_REALTIME_FACTOR}). */
  factor?: number;
  /** Floor in milliseconds (default: {@link FFMPEG_MIN_TIMEOUT_MS}). */
  minMs?: number;
  /** Ceiling in milliseconds (default: {@link FFMPEG_MAX_TIMEOUT_MS}). */
  maxMs?: number;
  /** Flat rate when the duration is unknown (default: {@link FFMPEG_UNKNOWN_TIMEOUT_MS}). */
  unknownMs?: number;
}

/**
 * Maximum delay granted to an ffmpeg invocation for a media of `durationSec` seconds.
 * An absent, zero, negative or non-finite duration falls back to the flat rate.
 */
export function ffmpegTimeoutMs(durationSec?: number | null, opts: FfmpegTimeoutOptions = {}): number {
  const factor = opts.factor ?? FFMPEG_REALTIME_FACTOR;
  const minMs = opts.minMs ?? FFMPEG_MIN_TIMEOUT_MS;
  const maxMs = opts.maxMs ?? FFMPEG_MAX_TIMEOUT_MS;
  const unknownMs = opts.unknownMs ?? FFMPEG_UNKNOWN_TIMEOUT_MS;

  const known = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0;
  // The flat rate does not go through the bounds: it is already a decided value, not an extrapolation to correct.
  if (!known) return Math.round(unknownMs);
  return Math.round(Math.min(maxMs, Math.max(minMs, durationSec * 1000 * factor)));
}

/** Failure message of an exceeded command — in English, like all backend errors. */
export function ffmpegTimeoutMessage(label: string, timeoutMs: number): string {
  return `ffmpeg step "${label}" exceeded its ${Math.round(timeoutMs / 1000)}s time limit and was killed`;
}

/**
 * Error distinct from an ordinary encoding failure: the NVENC → libx264 fallback must NOT replay a command
 * that timed out (it is not a missing encoder, and the fallback would consume the delay a second time before
 * failing the same way).
 */
export class FfmpegTimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(ffmpegTimeoutMessage(label, timeoutMs));
    this.name = 'FfmpegTimeoutError';
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

/** True if the error comes from a timeout (and not from an unavailable encoder). */
export const isFfmpegTimeout = (err: unknown): err is FfmpegTimeoutError => err instanceof FfmpegTimeoutError;
