// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Thumbnail sprite of the video timeline (one thumbnail about every 3 s, very light):
 * the FFmpeg worker tiles the captures into ONE JPEG image (`derived/{id}/timeline-sprite.jpg`),
 * described by `metadata.timelineSprite` and displayed as the timeline background on review.
 */

export interface TimelineSpritePlan {
  /** Actual interval between two thumbnails (s), stretched if the video is very long. */
  intervalSec: number;
  /** Expected number of thumbnails. */
  count: number;
  cols: number;
  rows: number;
  /** Dimensions of a thumbnail (px, even: encoder constraint). */
  tileW: number;
  tileH: number;
}

const BASE_INTERVAL_SEC = 3;
const MAX_TILES = 240; // ~12 min at 3 s; beyond that the interval stretches (sprite capped)
const TILE_WIDTH = 160;
const MAX_COLS = 10;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Sprite plan for a given video: null if the duration is unknown or zero. */
export function planTimelineSprite(
  durationSec: number | undefined,
  srcWidth: number | undefined,
  srcHeight: number | undefined,
): TimelineSpritePlan | null {
  if (!durationSec || durationSec <= 0) return null;
  let intervalSec = BASE_INTERVAL_SEC;
  let count = Math.max(1, Math.ceil(durationSec / intervalSec));
  if (count > MAX_TILES) {
    intervalSec = Math.ceil(durationSec / MAX_TILES);
    count = Math.max(1, Math.ceil(durationSec / intervalSec));
  }
  const cols = Math.min(count, MAX_COLS);
  const rows = Math.ceil(count / cols);
  const ratio = srcWidth && srcHeight && srcWidth > 0 && srcHeight > 0 ? srcHeight / srcWidth : 9 / 16;
  return { intervalSec, count, cols, rows, tileW: TILE_WIDTH, tileH: even(TILE_WIDTH * ratio) };
}
