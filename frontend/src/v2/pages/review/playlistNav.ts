// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PlaylistItemEntry } from '../../types/api';
import { reviewPath } from '../../lib/slug';

/** Chemin review d'un item + contexte playlist (lecture enchaînée 33.A). */
export const itemPath = (item: PlaylistItemEntry, playlistId: number): string | null =>
  item.media ? `${reviewPath(item.media)}?playlist=${playlistId}` : null;

/** Paramètres d'URL à propager entre les médias d'une même session de lecture (33.A/33.B). */
export const carryParams = (searchParams: URLSearchParams): string => {
  const out = new URLSearchParams();
  for (const k of ['playlist', 'live']) {
    const v = searchParams.get(k);
    if (v) out.set(k, v);
  }
  return `?${out.toString()}`;
};

/**
 * Voisin lisible le plus proche dans la direction donnée à partir de `idx`
 * (les versions sans média visible sont sautées). Null en bord de playlist.
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
