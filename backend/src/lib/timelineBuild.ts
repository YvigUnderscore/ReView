// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Building a timeline: PURE analysis, tested (Phase 45).
 *
 * An automatic timeline is a sequence of shots in production order, each represented by
 * its most advanced version. Two principles govern this file:
 *
 *  - a shot without media is not skipped, it is replaced by a placeholder card of its
 *    duration. A timeline that hides its gaps lies about its duration and conceals exactly
 *    what a supervisor is trying to see;
 *  - the displayed duration is that of the actual media. When it diverges from the frame
 *    range declared on the shot, the gap is FLAGGED, never silently corrected: reframing
 *    without saying so would turn a visible problem into a surprise at the final edit.
 */

/** Duration of a placeholder card when the shot has no frame range (seconds). */
export const PLACEHOLDER_DURATION = 4;

/** Tolerated gap between media duration and declared duration before flagging (seconds). */
const DURATION_TOLERANCE = 0.5;

export interface ShotRow {
  id: number;
  code: string;
  name: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  startFrame: number | null;
  endFrame: number | null;
}

export interface PickRow {
  versionId: number;
  versionName: string;
  department: string | null;
  mediaId: number | null;
  mediaDuration: number | null;
}

export interface TimelineItem {
  order: number;
  startTime: number;
  duration: number;
  shotId: number;
  shotCode: string;
  shotName: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  versionId: number | null;
  versionName: string | null;
  department: string | null;
  mediaId: number | null;
  /** No published media: the slot is held by a placeholder card. */
  placeholder: boolean;
  /** The media duration deviates from the frame range declared on the shot. */
  durationMismatch: boolean;
}

/** Declared duration of a shot from its frames, or null if the range is missing or absurd. */
export function declaredDuration(shot: ShotRow, fps: number): number | null {
  if (shot.startFrame === null || shot.endFrame === null || fps <= 0) return null;
  const frames = shot.endFrame - shot.startFrame + 1;
  return frames > 0 ? frames / fps : null;
}

/**
 * Duration of a clip. The media is authoritative; failing that, the shot's frame range;
 * failing that, a placeholder duration, so that a shot with nothing still takes a visible slot.
 */
export function clipDuration(mediaDuration: number | null, declared: number | null): number {
  if (mediaDuration !== null && mediaDuration > 0) return mediaDuration;
  if (declared !== null && declared > 0) return declared;
  return PLACEHOLDER_DURATION;
}

/** Assembles the shots and the elected versions into a timestamped sequence of clips. */
export function buildItems(shots: ShotRow[], picks: Map<number, PickRow>, fps: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  let cursor = 0;
  shots.forEach((shot, index) => {
    const pick = picks.get(shot.id) ?? null;
    const declared = declaredDuration(shot, fps);
    const duration = clipDuration(pick?.mediaDuration ?? null, declared);
    const mediaDuration = pick?.mediaDuration ?? null;
    items.push({
      order: index,
      startTime: Math.round(cursor * 1000) / 1000,
      duration: Math.round(duration * 1000) / 1000,
      shotId: shot.id,
      shotCode: shot.code,
      shotName: shot.name,
      sequenceId: shot.sequenceId,
      sequenceCode: shot.sequenceCode,
      versionId: pick?.versionId ?? null,
      versionName: pick?.versionName ?? null,
      department: pick?.department ?? null,
      mediaId: pick?.mediaId ?? null,
      placeholder: !pick || pick.mediaId === null,
      durationMismatch:
        mediaDuration !== null &&
        declared !== null &&
        Math.abs(mediaDuration - declared) > DURATION_TOLERANCE,
    });
    cursor += duration;
  });
  return items;
}

/** Total of a timeline (seconds), rounded to the millisecond. */
export function totalDuration(items: TimelineItem[]): number {
  return Math.round(items.reduce((sum, it) => sum + it.duration, 0) * 1000) / 1000;
}

export interface DiffEntry {
  shotCode: string;
  from: string | null;
  to: string | null;
}

/** What changed from one revision to the next: the question every supervisor asks. */
export interface TimelineDiff {
  added: string[];
  removed: string[];
  changed: DiffEntry[];
}

/**
 * Compares two states of a timeline by shot code. The code is the only stable identity:
 * a shot can be recreated (new identifier) without the timeline having changed.
 */
export function diffItems(
  previous: readonly { shotCode: string; versionName: string | null }[],
  current: readonly { shotCode: string; versionName: string | null }[],
): TimelineDiff {
  const before = new Map(previous.map((it) => [it.shotCode, it.versionName]));
  const after = new Map(current.map((it) => [it.shotCode, it.versionName]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: DiffEntry[] = [];

  for (const [code, version] of after) {
    if (!before.has(code)) {
      added.push(code);
      continue;
    }
    const from = before.get(code) ?? null;
    if (from !== version) changed.push({ shotCode: code, from, to: version ?? null });
  }
  for (const code of before.keys()) if (!after.has(code)) removed.push(code);

  return { added, removed, changed };
}
