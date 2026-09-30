// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PlaylistItemEntry } from '../../types/api';
import { findPlayableNeighbor } from '../review/playlistNav';

/**
 * Enchaînement d'une playlist en review (constat vague 5).
 *
 * La fin d'un média ne faisait rien : passer vingt plans en dailies demandait vingt clics
 * sur la flèche « suivant » — et en salle live, vingt clics du pilote. Le montage
 * automatique enchaîne depuis la Phase 45 (`useTimelineChain`) ; on reprend la même
 * mécanique, appliquée aux items d'une playlist, avec une bascule pour la désarmer.
 */

/**
 * Rang de l'item qui porte ce média. Les items d'une playlist désignent des **versions** ;
 * la review, elle, connaît le média affiché — c'est par lui qu'on retrouve sa place.
 */
export const itemIndexOfMedia = (items: PlaylistItemEntry[], mediaId: number): number =>
  items.findIndex((it) => it.media?.id === mediaId);

/** Item lisible suivant (les versions sans média visible sont sautées), null en fin de liste. */
export function nextPlayableAfterMedia(
  items: PlaylistItemEntry[],
  mediaId: number,
): PlaylistItemEntry | null {
  const idx = itemIndexOfMedia(items, mediaId);
  return idx < 0 ? null : findPlayableNeighbor(items, idx, 1);
}

const STORAGE_KEY = 'review:playlist:autoAdvance';

/** Enchaînement armé par défaut : c'est ce qu'on attend d'une session de dailies. */
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
    // Stockage indisponible (navigation privée) : choix de session seulement.
  }
};
