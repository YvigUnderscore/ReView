// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Progress of a media job, published via `job.updateProgress`.
 *
 * Without it, a job stuck for six hours is indistinguishable from a long encode: the admin dashboard only shows a mute
 * "active". Each type of work is therefore split into named steps, each occupying a range of the global percentage,
 * and we interpolate within a step with the progress reported by ffmpeg. The ranges are roughly proportioned to the
 * observed cost: on a video, the HLS ladder weighs half the work.
 */

export type MediaJobKind = 'transcode' | 'thumbnail' | 'convert3d' | 'scan';

export type MediaJobStep =
  | 'download'
  | 'probe'
  | 'proxy'
  | 'thumbnail'
  | 'renditions'
  | 'client'
  | 'scenes'
  | 'sprite'
  | 'convert'
  | 'scan'
  | 'done';

/** State published on the BullMQ job (serialised as-is in Redis). */
export interface MediaJobProgress {
  step: MediaJobStep;
  /** Global percentage, integer, 0-100. */
  percent: number;
  /** Rank of the current rendition (1-based), when the step is repeated. */
  index?: number;
  /** Total number of repetitions of the step. */
  total?: number;
}

type Range = readonly [number, number];

/** Percentage ranges per type of work. The sum covers 0 → 100. */
const RANGES: Record<MediaJobKind, Partial<Record<MediaJobStep, Range>>> = {
  transcode: {
    download: [0, 8],
    probe: [8, 10],
    proxy: [10, 32],
    thumbnail: [32, 36],
    renditions: [36, 84],
    client: [84, 90],
    scenes: [90, 93],
    sprite: [93, 98],
    done: [100, 100],
  },
  thumbnail: {
    download: [0, 30],
    probe: [30, 40],
    thumbnail: [40, 95],
    done: [100, 100],
  },
  convert3d: {
    download: [0, 20],
    convert: [20, 90],
    done: [100, 100],
  },
  scan: {
    download: [0, 50],
    scan: [50, 95],
    done: [100, 100],
  },
};

export interface MediaProgressOptions {
  /** 0-based rank of the current repetition (HLS renditions). */
  index?: number;
  /** Total number of repetitions. */
  total?: number;
  /** Progress 0→1 within the current repetition (ffmpeg progress). */
  fraction?: number;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * Global percentage at the start (`fraction` absent) or during a step.
 * An step unknown for this type of work returns 0: it is a programming error, and must never make a transcode fail.
 */
export function mediaJobProgress(
  kind: MediaJobKind,
  step: MediaJobStep,
  opts: MediaProgressOptions = {},
): MediaJobProgress {
  const range = RANGES[kind][step];
  if (!range) return { step, percent: 0 };
  const [from, to] = range;

  const total = opts.total && opts.total > 0 ? opts.total : 1;
  const index = Math.min(Math.max(opts.index ?? 0, 0), total - 1);
  const within = clamp01((index + clamp01(opts.fraction ?? 0)) / total);

  const percent = Math.round(from + (to - from) * within);
  const out: MediaJobProgress = { step, percent };
  if (opts.total && opts.total > 0) {
    out.index = index + 1;
    out.total = opts.total;
  }
  return out;
}

/** Time position of an ffmpeg `timemark` ("00:01:23.45") in seconds. */
export function parseTimemarkSec(timemark: unknown): number | null {
  if (typeof timemark !== 'string') return null;
  const m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(timemark.trim());
  if (!m) return null;
  const [h, min, sec] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  return h * 3600 + min * 60 + sec;
}

/**
 * Progress 0→1 of an ffmpeg command, from its `progress` event.
 *
 * `percent` is only filled in when fluent-ffmpeg knows the total duration — which is not the case for a synthetic
 * input nor for a container without a duration header. We then fall back on the `timemark`, relative to the probed
 * duration of the media. Without either, `null`: the caller keeps the percentage at the start of the step rather
 * than inventing one.
 */
export function ffmpegFraction(
  progress: { percent?: number | null; timemark?: string | null },
  durationSec?: number,
): number | null {
  const pct = progress.percent;
  if (typeof pct === 'number' && Number.isFinite(pct)) return clamp01(pct / 100);
  const at = parseTimemarkSec(progress.timemark);
  if (at !== null && durationSec !== undefined && durationSec > 0) return clamp01(at / durationSec);
  return null;
}
