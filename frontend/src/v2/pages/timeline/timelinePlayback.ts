// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TimelineClip } from '../../types/api';

/**
 * Continuous playback of a montage — PURE analysis, tested (Phase 46).
 *
 * The montage plays like a film: a single time bar, from zero to the end, with no interruption
 * when moving from one shot or sequence to the next. This file holds the mapping between this
 * global time and the shot that must be on screen, at its own position.
 */

/** The shot occupying the instant `t` of the montage (the last one if `t` exceeds the end). */
export function clipIndexAt(items: readonly TimelineClip[], t: number): number {
  if (items.length === 0) return -1;
  for (let i = 0; i < items.length; i++) {
    const clip = items[i];
    if (t < clip.startTime + clip.duration) return Math.max(0, i);
  }
  return items.length - 1;
}

/** Position inside the shot, clamped to its duration. */
export function localTimeAt(clip: TimelineClip, t: number): number {
  return Math.min(Math.max(t - clip.startTime, 0), clip.duration);
}

/** Global time corresponding to a local position in a shot. */
export function globalTimeOf(clip: TimelineClip, localTime: number): number {
  return clip.startTime + Math.min(Math.max(localTime, 0), clip.duration);
}

/** Band of a sequence on the time bar: from when to when, under which code. */
export interface SequenceSpan {
  sequenceId: number | null;
  sequenceCode: string | null;
  startTime: number;
  duration: number;
}

/**
 * Groups consecutive shots of the same sequence.
 *
 * The time bar must show at a glance where we are in the film: a thin line per shot is not enough,
 * the rhythm of sequences is needed. Shots outside any sequence form their own bands rather than
 * merging with the previous one.
 */
export function sequenceSpans(items: readonly TimelineClip[]): SequenceSpan[] {
  const spans: SequenceSpan[] = [];
  for (const clip of items) {
    const last = spans[spans.length - 1];
    if (last && last.sequenceId === clip.sequenceId && clip.sequenceId !== null) {
      last.duration += clip.duration;
      continue;
    }
    spans.push({
      sequenceId: clip.sequenceId,
      sequenceCode: clip.sequenceCode,
      startTime: clip.startTime,
      duration: clip.duration,
    });
  }
  return spans;
}

/**
 * Indices of the shots that open a sequence.
 *
 * Same rule as `sequenceSpans`: a shot without a sequence always opens its own band, otherwise two
 * orphan shots would be presented as if they belonged to the same block.
 */
export function sequenceStarts(items: readonly TimelineClip[]): number[] {
  const starts: number[] = [];
  items.forEach((clip, i) => {
    if (i === 0 || clip.sequenceId === null || clip.sequenceId !== items[i - 1].sequenceId) starts.push(i);
  });
  return starts;
}

/** Position of a shot on the band, as a percentage of its width. */
export interface TrackSlot {
  index: number;
  leftPct: number;
  widthPct: number;
}

/**
 * Lays out the montage band: each shot occupies its duration, one after the previous.
 *
 * This is what makes it a real timeline rather than a list of thumbnails — the width says the
 * duration. As long as no duration is known, the shots share the band equally: an approximate band
 * is better than an empty one, on which one could not even click.
 */
export function trackLayout(items: readonly TimelineClip[], total: number): TrackSlot[] {
  if (items.length === 0) return [];
  if (!(total > 0)) {
    const widthPct = 100 / items.length;
    return items.map((_, index) => ({ index, leftPct: index * widthPct, widthPct }));
  }
  return items.map((clip, index) => ({
    index,
    leftPct: (clip.startTime / total) * 100,
    widthPct: (clip.duration / total) * 100,
  }));
}

/**
 * Is this shot held by a clock rather than by a video element?
 *
 * Two cases fall here: the placeholder (no published media) and the **still image**. An image handed
 * to a `<video>` tag fails demuxing (`DEMUXER_ERROR_COULD_NOT_OPEN`) and playback never starts — this
 * is what blocked any montage whose first shot carried an image: the button stayed on "Play" and
 * the counter on `00:00`, without a word. `preferPlayable` on the server favours video, but a shot
 * whose only published version is an image arrives in the montage as is.
 */
export function holdsOnClock(clip: TimelineClip | null | undefined): boolean {
  if (!clip) return false;
  return clip.mediaId === null || clip.mediaKind === 'IMAGE';
}

/** True when the shot carries a still image to display (and not an empty placeholder). */
export function isStillClip(clip: TimelineClip | null | undefined): boolean {
  return !!clip && clip.mediaId !== null && clip.mediaKind === 'IMAGE';
}

/**
 * The next playable shot — the one a video buffer can preload. Placeholders **and images** have
 * nothing to load in a video element: they are skipped here and held by the clock when their time
 * comes.
 */
export function nextPlayableIndex(items: readonly TimelineClip[], from: number): number {
  for (let i = from + 1; i < items.length; i++) if (!holdsOnClock(items[i])) return i;
  return -1;
}

/** `mm:ss` position of an instant of the montage, to display next to the total duration. */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const total = Math.floor(safe);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
