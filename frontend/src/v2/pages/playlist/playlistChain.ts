// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PlaylistItemEntry } from '../../types/api';
import { findPlayableNeighbor } from '../review/playlistNav';

/**
 * Chaining of a playlist under review (finding from wave 5).
 *
 * The end of a media did nothing: going through twenty shots in dailies required twenty clicks on
 * the "next" arrow, and in a live room, twenty clicks from the driver. The automatic edit has
 * chained since Phase 45 (`useTimelineChain`). The same mechanism is reused here, applied to the
 * items of a playlist, with a toggle to disarm it.
 */

/**
 * Rank of the item that carries this media. Playlist items designate **versions**; the review,
 * however, knows the displayed media, and that is how its place is found.
 */
export const itemIndexOfMedia = (items: PlaylistItemEntry[], mediaId: number): number =>
  items.findIndex((it) => it.media?.id === mediaId);

/** Next playable item (versions without a visible media are skipped), null at the end of the list. */
export function nextPlayableAfterMedia(
  items: PlaylistItemEntry[],
  mediaId: number,
): PlaylistItemEntry | null {
  const idx = itemIndexOfMedia(items, mediaId);
  return idx < 0 ? null : findPlayableNeighbor(items, idx, 1);
}

const STORAGE_KEY = 'review:playlist:autoAdvance';

/** Chaining armed by default: this is what is expected of a dailies session. */
export const loadAutoAdvance = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
};

export const saveAutoAdvance = (enabled: boolean): void => {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Storage unavailable (private browsing): the choice holds for the session only.
  }
};
