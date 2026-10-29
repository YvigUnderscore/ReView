// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { mediaReviewAspect, reviewAspect, reviewAspectLabel } from './reviewAspect';
import { DEFAULT_REVIEW_ASPECT } from './frameRect';

/**
 * The review frame's ratio: default pipeline settings, recorded presentation first.
 *
 * Both halves of the rule matter equally. Without the first, a project delivering in scope would be
 * reviewed in 16/9; without the second, applying the project's ratio to an already annotated media would
 * move on-screen annotations placed on validated reviews.
 */
describe('reviewAspect', () => {
  it('takes the inherited delivery ratio when nothing is recorded', () => {
    expect(reviewAspect({ delivery: 2.39 })).toEqual({ value: 2.39, frozen: false });
  });

  it("lets the aspect ALREADY recorded take precedence over the project's ratio", () => {
    expect(reviewAspect({ presentation: 2.39, delivery: 16 / 9 })).toEqual({ value: 2.39, frozen: true });
  });

  it('falls back on 16:9 when neither the presentation nor the detail gives a ratio', () => {
    expect(reviewAspect({})).toEqual({ value: DEFAULT_REVIEW_ASPECT, frozen: false });
  });

  // An aberrant aspect (old presentation, corrupted setting) would make a zero-height frame:
  // it is treated as absent rather than emptying the viewer.
  it('ignores a degenerate ratio, on both sides', () => {
    expect(reviewAspect({ presentation: 0, delivery: 2.39 })).toEqual({ value: 2.39, frozen: false });
    expect(reviewAspect({ presentation: Number.NaN, delivery: 2.39 })).toEqual({
      value: 2.39,
      frozen: false,
    });
    expect(reviewAspect({ presentation: null, delivery: Number.POSITIVE_INFINITY })).toEqual({
      value: DEFAULT_REVIEW_ASPECT,
      frozen: false,
    });
  });
});

describe('mediaReviewAspect — the rule taken from a media detail', () => {
  it('serves the inherited ratio of a media without staging', () => {
    expect(mediaReviewAspect({ splatPresentation: null, deliveryAspect: 1.85 })).toEqual({
      value: 1.85,
      frozen: false,
    });
  });

  it('respects the frozen frame of an already staged media', () => {
    const data = { splatPresentation: { camera: { aspect: 4 / 3 } }, deliveryAspect: 1.85 };
    expect(mediaReviewAspect(data)).toEqual({ value: 4 / 3, frozen: true });
  });

  // The detail is not loaded yet: the viewer still mounts, on a neutral frame.
  it('holds before an absent detail', () => {
    expect(mediaReviewAspect(undefined)).toEqual({ value: DEFAULT_REVIEW_ASPECT, frozen: false });
  });
});

describe('reviewAspectLabel', () => {
  it('names the known formats', () => {
    expect(reviewAspectLabel(16 / 9)).toBe('16:9');
    expect(reviewAspectLabel(4 / 3)).toBe('4:3');
    expect(reviewAspectLabel(1)).toBe('1:1');
  });

  // A real pipeline resolution is never exactly the format it announces.
  it('recognises a format to the resolution (2048×858 = scope)', () => {
    expect(reviewAspectLabel(2048 / 858)).toBe('2.39:1');
    expect(reviewAspectLabel(1998 / 1080)).toBe('1.85:1');
    expect(reviewAspectLabel(3840 / 2160)).toBe('16:9');
  });

  it('gives the figure of an unusual ratio rather than forcing it onto a known one', () => {
    expect(reviewAspectLabel(2)).toBe('2.00:1');
    expect(reviewAspectLabel(1.43)).toBe('1.43:1');
  });

  it('falls back on 16:9 in front of a degenerate ratio', () => {
    expect(reviewAspectLabel(0)).toBe('16:9');
    expect(reviewAspectLabel(Number.NaN)).toBe('16:9');
  });
});
