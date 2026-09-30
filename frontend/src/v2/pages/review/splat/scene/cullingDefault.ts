// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Culling Spark du viewer splat : le défaut, et la mémoire du choix — écrits une seule fois.
 *
 * Le défaut vivait en double : au montage de la scène (`useSplat`, `applyCulling(spark, …)`) et
 * dans l'état du HUD (`useSplatView`). Les deux littéraux devaient rester d'accord sans que rien
 * ne l'impose — une divergence et l'interrupteur du panneau mentait dès le premier rendu, sans
 * que le nuage ne change. Ils lisent désormais tous deux `readCullingOff()`.
 *
 * `off === true` = culling **neutralisé** (`CULLING_OFF` de `viewerConfig`) : rien ne disparaît
 * en zoom fort ni en bord de cadre, au prix du rendu de splats qu'on ne verra pas.
 *
 * **Le culling est actif par défaut** (Phase 50, lot 8). Il était neutralisé depuis 10.G-V1 pour
 * qu'aucun splat ne disparaisse ; sur les scans que les studios ouvrent réellement, cela revenait
 * à payer en permanence le rendu de gaussiennes hors cadre. Qui voit des splats s'évanouir en
 * zoom fort garde l'échappatoire à un clic (panneau *Scène*, ou menu clic droit du viewer).
 *
 * Le choix est **mémorisé par utilisateur**, comme la grille de sol (`useSceneGrid`) : c'est une
 * préférence de confort, pas un réglage de studio — aucun héritage admin ne le décide.
 */

/** Clé de la préférence locale (par navigateur, par utilisateur). */
const STORAGE_KEY = 'review-splat-culling-off';

/** Défaut hors préférence enregistrée : culling actif. */
export const DEFAULT_CULLING_OFF = false;

/** Lit la préférence depuis sa valeur brute — fonction pure, testable sans `localStorage`. */
export function parseCullingOff(raw: string | null): boolean {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return DEFAULT_CULLING_OFF; // absente ou illisible : le défaut, jamais une valeur au hasard
}

/** Préférence de l'utilisateur, ou le défaut. */
export function readCullingOff(): boolean {
  try {
    return parseCullingOff(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Stockage inaccessible (mode privé, politique de site) : le défaut suffit à afficher.
    return DEFAULT_CULLING_OFF;
  }
}

/** Mémorise le choix de l'utilisateur. */
export function writeCullingOff(off: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, off ? '1' : '0');
  } catch {
    // Rien à rattraper : la session en cours garde son réglage, il ne survivra pas au rechargement.
  }
}
