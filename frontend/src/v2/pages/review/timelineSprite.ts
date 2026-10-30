// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Display of the timeline thumbnail sprite of the video timeline: the worker produces ONE tiled JPEG
 * image (`metadata.timelineSprite`), and the timeline shows the thumbnail under the cursor via
 * background-position. Pure helpers, tested.
 */

export interface TimelineSpriteMeta {
  intervalSec: number;
  count: number;
  cols: number;
  rows: number;
  tileW: number;
  tileH: number;
}

export interface SpriteSlot {
  /** CSS background style to display thumbnail `index` at the requested height. */
  backgroundSize: string;
  backgroundPosition: string;
}

/** Thumbnail index for a given instant (clamped to the sprite). */
export function spriteIndexAt(timeSec: number, meta: TimelineSpriteMeta): number {
  const i = Math.floor(Math.max(0, timeSec) / meta.intervalSec);
  return Math.min(meta.count - 1, Math.max(0, i));
}

/** CSS (size + position) to render thumbnail `index` in a cell of height `displayH` px. */
export function spriteSlotCss(index: number, meta: TimelineSpriteMeta, displayH: number): SpriteSlot {
  const scale = displayH / meta.tileH;
  const col = index % meta.cols;
  const row = Math.floor(index / meta.cols);
  return {
    backgroundSize: `${meta.cols * meta.tileW * scale}px ${meta.rows * meta.tileH * scale}px`,
    backgroundPosition: `${-col * meta.tileW * scale}px ${-row * meta.tileH * scale}px`,
  };
}
