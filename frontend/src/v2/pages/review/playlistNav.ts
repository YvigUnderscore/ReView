// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PlaylistItemEntry } from '../../types/api';
import { reviewPath } from '../../lib/slug';

/** Review path of an item + playlist context (chained playback, 33.A). */
export const itemPath = (item: PlaylistItemEntry, playlistId: number): string | null =>
  item.media ? `${reviewPath(item.media)}?playlist=${playlistId}` : null;

/** URL parameters to propagate between the media of one playback session (33.A/33.B). */
export const carryParams = (searchParams: URLSearchParams): string => {
  const out = new URLSearchParams();
  for (const k of ['playlist', 'live']) {
    const v = searchParams.get(k);
    if (v) out.set(k, v);
  }
  return `?${out.toString()}`;
};

/**
 * Closest readable neighbour in the given direction from `idx`
 * (versions with no visible media are skipped). Null at the edges of the playlist.
 */
export const findPlayableNeighbor = (
  items: PlaylistItemEntry[],
  idx: number,
  dir: -1 | 1,
): PlaylistItemEntry | null => {
  if (idx < 0) return null;
  for (let i = idx + dir; i >= 0 && i < items.length; i += dir) {
    if (items[i].media) return items[i];
  }
  return null;
};
