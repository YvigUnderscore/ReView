// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

/**
 * Time offset of the A/B comparison, in frames.
 *
 * The B panes copied the master's time as is. That is the right setting when the two versions
 * share the same conform, and the wrong one as soon as there has been a retime, a lengthened
 * handle or a moved entry point between v02 and v03. The supervisor checking a join then saw
 * two images that do not match, with no way to realign them other than giving up on sync.
 *
 * The offset lives here, outside the React tree: `useVideoSync` reads it for each slave pane,
 * and the player shortcuts adjust it. It applies to all B panes. A per-pane offset would require
 * hoisting it into `useCompareState`, which the 2×2 grid will justify on the day three different
 * conforms are compared at once.
 */

/** Bounds: beyond ten seconds of offset, it is no longer a conform realignment. */
export const MAX_COMPARE_OFFSET_FRAMES = 240;

/** Clamps an offset into the bounds, at whole-frame precision. */
export function clampOffsetFrames(frames: number): number {
  if (!Number.isFinite(frames)) return 0;
  return Math.max(-MAX_COMPARE_OFFSET_FRAMES, Math.min(MAX_COMPARE_OFFSET_FRAMES, Math.round(frames)));
}

interface CompareOffsetState {
  /** Current offset, in frames. Positive: version B is ahead of A. */
  frames: number;
  /** The same offset in seconds, the only unit an `HTMLVideoElement` knows. */
  seconds: number;
  /** Adds `delta` frames to the current offset, at the given frame rate. */
  nudge: (delta: number, fps: number) => void;
  /** Sets the offset (used by tests and by any direct input). */
  set: (frames: number, fps: number) => void;
  reset: () => void;
}

const seconds = (frames: number, fps: number): number => (Number.isFinite(fps) && fps > 0 ? frames / fps : 0);

export const useCompareOffset = create<CompareOffsetState>((setState) => ({
  frames: 0,
  seconds: 0,
  nudge: (delta, fps) =>
    setState((s) => {
      const frames = clampOffsetFrames(s.frames + delta);
      return { frames, seconds: seconds(frames, fps) };
    }),
  set: (frames, fps) => {
    const clamped = clampOffsetFrames(frames);
    setState({ frames: clamped, seconds: seconds(clamped, fps) });
  },
  reset: () => setState({ frames: 0, seconds: 0 }),
}));
