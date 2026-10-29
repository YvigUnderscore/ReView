// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TimelineClip } from '../../types/api';

/**
 * Navigation through an automatic montage (Phase 45) — PURE analysis, tested.
 *
 * Title cards (shots without a published media) count in the montage: they give its real duration
 * and flag what is missing. But they are not playable, so playback skips them — the sequence goes
 * from one media to the next, without stopping on a gap.
 */

/** Position of the clip carrying this media, -1 if it is not in this montage. */
export function clipIndexOfMedia(items: readonly TimelineClip[], mediaId: number): number {
  return items.findIndex((it) => it.mediaId === mediaId);
}

/** Nearest playable clip in the given direction, null at the montage edge. */
export function playableNeighbor(
  items: readonly TimelineClip[],
  index: number,
  dir: -1 | 1,
): TimelineClip | null {
  if (index < 0) return null;
  for (let i = index + dir; i >= 0 && i < items.length; i += dir) {
    const clip = items[i];
    if (clip && clip.mediaId !== null) return clip;
  }
  return null;
}

/** Play rank (1-based) of a clip among the playable clips only, and their total. */
export function playablePosition(
  items: readonly TimelineClip[],
  index: number,
): { position: number; total: number } {
  const total = items.filter((it) => it.mediaId !== null).length;
  if (index < 0) return { position: 0, total };
  const position = items.slice(0, index + 1).filter((it) => it.mediaId !== null).length;
  return { position, total };
}

/** Total duration formatted `m:ss` (production montages stay under an hour). */
export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const total = Math.round(safe);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
