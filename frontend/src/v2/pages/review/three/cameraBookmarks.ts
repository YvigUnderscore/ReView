// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { t } from '../../../i18n';
import type { CameraBookmark, SplatCamera } from '../reviewTypes';

/** Nombre maximal de bookmarks — aligné sur les raccourcis clavier Alt+1 à Alt+9. */
export const MAX_BOOKMARKS = 9;

/** Touches physiques du rappel de vue : rangée des chiffres ou pavé numérique. */
const DIGIT_CODE = /^(?:Digit|Numpad)([1-9])$/;

/**
 * Indice du bookmark visé par une frappe, ou `null` si la frappe ne le concerne pas.
 *
 * Les chiffres nus appartiennent à la bascule de mode du chrome, dans les quatre viewers :
 * sur un média spatial, `1`/`2`/`3` rappelaient une vue **et** changeaient de mode, deux
 * réponses pour une frappe. Le rappel passe donc sous **Alt**, ce qui libère les neuf slots
 * au lieu des seuls 4-9 que laissait la bascule.
 *
 * La touche est lue par sa **position** (`code`) et non par le caractère produit : sous Alt,
 * `key` vaut le caractère de la disposition (`&` en AZERTY, `¡` sur macOS) — jamais `1`.
 * Même parti pris que la navigation en vol (ZQSD = WASD).
 */
export function bookmarkShortcutIndex(
  e: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'metaKey'>,
  count: number,
): number | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  const digit = DIGIT_CODE.exec(e.code)?.[1];
  if (!digit) return null;
  const index = Number(digit) - 1;
  return index < count ? index : null;
}

/**
 * Logique pure des bookmarks caméra (39.D), partagée par le hook et testée isolément.
 * Ajoute la vue courante avec un libellé auto (« Vue N ») ; renvoie `null` si la liste est pleine
 * (le hook affiche alors une erreur, sans mutation).
 */
export function appendBookmark(list: CameraBookmark[], camera: SplatCamera): CameraBookmark[] | null {
  if (list.length >= MAX_BOOKMARKS) return null;
  return [...list, { camera, label: t('camera.viewN', { n: list.length + 1 }) }];
}

/** Retire le bookmark d'indice `index` (hors bornes → liste inchangée). */
export function removeBookmarkAt(list: CameraBookmark[], index: number): CameraBookmark[] {
  if (index < 0 || index >= list.length) return list;
  return list.filter((_, i) => i !== index);
}
