// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CameraBookmark, SplatCamera } from '../reviewTypes';

/** Nombre maximal de bookmarks — aligné sur les raccourcis clavier 1-9. */
export const MAX_BOOKMARKS = 9;

/**
 * Logique pure des bookmarks caméra (39.D), partagée par le hook et testée isolément.
 * Ajoute la vue courante avec un libellé auto (« Vue N ») ; renvoie `null` si la liste est pleine
 * (le hook affiche alors une erreur, sans mutation).
 */
export function appendBookmark(list: CameraBookmark[], camera: SplatCamera): CameraBookmark[] | null {
  if (list.length >= MAX_BOOKMARKS) return null;
  return [...list, { camera, label: `Vue ${list.length + 1}` }];
}

/** Retire le bookmark d'indice `index` (hors bornes → liste inchangée). */
export function removeBookmarkAt(list: CameraBookmark[], index: number): CameraBookmark[] {
  if (index < 0 || index >= list.length) return list;
  return list.filter((_, i) => i !== index);
}
