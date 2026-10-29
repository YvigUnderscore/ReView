// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DEFAULT_REVIEW_ASPECT } from './frameRect';

/**
 * Ratio of the review frame of a spatial media (3D, splat): ONE rule, kept here.
 *
 * WHY. The letterboxed frame drew its aspect from the recorded camera presentation, and the presentation
 * copied it from the camera, which held it from the 16/9 default: the ratio copied itself, and the first
 * staging recording froze 16/9 without anyone having chosen it. The ratio now comes from the pipeline
 * settings (inherited resolution: studio → project → sequence → shot), served by the media's detail
 * (`deliveryAspect`).
 *
 * An aspect ALREADY recorded in a presentation keeps precedence: the letterbox guide anchors the normalised
 * 2D annotations, and changing the frame of an already annotated media would move on-screen annotations
 * placed on validated reviews (`shapesOutsideFrame` warns the author, it migrates nothing). The project's
 * ratio is therefore a DEFAULT, not a takeover.
 */
export interface ReviewAspectSources {
  /** Aspect frozen in the recorded camera presentation, if there is one. */
  presentation?: number | null;
  /** Delivery ratio inherited from the pipeline settings, served by the media's detail. */
  delivery?: number | null;
}

export interface ReviewAspect {
  /** Width/height ratio to apply to the frame. */
  value: number;
  /** True when it comes from a recorded presentation: the pipeline settings no longer apply to it. */
  frozen: boolean;
}

/** A ratio is only usable if finite and strictly positive (otherwise: zero-height frame). */
const usable = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Effective ratio of the review frame and its origin. Pure. */
export function reviewAspect(sources: ReviewAspectSources): ReviewAspect {
  if (usable(sources.presentation)) return { value: sources.presentation, frozen: true };
  return { value: usable(sources.delivery) ? sources.delivery : DEFAULT_REVIEW_ASPECT, frozen: false };
}

/**
 * The same rule, taken from a media detail: this is the form the viewers call (pane, PiP, dock, scene).
 * Going through it avoids copying the cascade at each point of consumption, which is exactly that copy
 * that had let the ratio freeze at 16/9.
 */
export function mediaReviewAspect(
  data:
    | { splatPresentation?: { camera?: { aspect?: number } } | null; deliveryAspect?: number | null }
    | null
    | undefined,
): ReviewAspect {
  return reviewAspect({
    presentation: data?.splatPresentation?.camera?.aspect,
    delivery: data?.deliveryAspect,
  });
}

/** Named formats: a ratio reads better as "2.39:1" than "2.39". */
const NAMED: [number, string][] = [
  [16 / 9, '16:9'],
  [2.39, '2.39:1'],
  [1.85, '1.85:1'],
  [4 / 3, '4:3'],
  [1, '1:1'],
];

/**
 * Ratio as text for the screen. The tolerance covers the real resolutions of a pipeline: 2048×858 is not
 * exactly 2.39 and still reads "2.39:1".
 */
export function reviewAspectLabel(aspect: number): string {
  const a = usable(aspect) ? aspect : DEFAULT_REVIEW_ASPECT;
  return NAMED.find(([v]) => Math.abs(v - a) < 0.01)?.[1] ?? `${a.toFixed(2)}:1`;
}
