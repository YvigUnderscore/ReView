// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CLICK_SLOP_PX, isClickGesture } from '../three/usdPicking';

/**
 * Partage du bouton droit dans les viewers spatiaux (Phase 50, lot 8).
 *
 * Le clic droit y porte deux gestes contradictoires : **maintenu**, c'est le vol (regard souris
 * + ZQSD/WASD) ; **bref**, c'est le menu contextuel, qui porte les actions partout ailleurs dans
 * ReView. Les départager demande un seuil, et un seuil se discute : on l'écrit donc une fois,
 * en clair, plutôt que de le disperser dans les gestionnaires.
 *
 * Deux conditions, car l'une sans l'autre laisse passer un faux positif :
 *  - **immobile** — même tolérance que le clic gauche (`CLICK_SLOP_PX`), un vol commence presque
 *    toujours par un mouvement de souris ;
 *  - **court** — un clic droit maintenu en place, sans bouger, reste une intention de vol (on
 *    s'apprête à avancer au clavier) et ne doit pas ouvrir de menu au relâchement.
 */

/** Déplacement maximal du pointeur pour un clic droit bref (px). */
export const CONTEXT_TAP_SLOP_PX = CLICK_SLOP_PX;

/** Durée maximale d'appui pour un clic droit bref (ms) — au-delà, c'était un vol. */
export const CONTEXT_TAP_MAX_MS = 250;

export interface ContextTap {
  /** Déplacement du pointeur entre l'appui et le relâchement (px). */
  dx: number;
  dy: number;
  /** Durée d'appui du bouton droit (ms). */
  heldMs: number;
}

/** Ce geste du bouton droit demande-t-il le menu contextuel (et non un vol) ? */
export function isContextTap({ dx, dy, heldMs }: ContextTap): boolean {
  return isClickGesture(dx, dy, CONTEXT_TAP_SLOP_PX) && heldMs <= CONTEXT_TAP_MAX_MS;
}
