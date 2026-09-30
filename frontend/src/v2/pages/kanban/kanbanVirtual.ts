// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arithmétique de la colonne virtualisée (vague 2 — échelle).
 *
 * Une colonne de kanban montait jusqu'à soixante cartes puis s'arrêtait sur un « et
 * quarante autres » qu'aucun geste ne permettait d'atteindre : sur un long-métrage
 * (deux mille plans, dix mille tâches), la moitié du travail du studio était hors de
 * portée, et les soixante cartes montées portaient chacune un enregistrement dnd-kit et
 * un menu contextuel Radix.
 *
 * La colonne défile désormais pour elle-même et ne monte que sa fenêtre visible. Les
 * décisions qui n'ont pas besoin du DOM sont isolées ici pour être vérifiables sans
 * navigateur.
 */

/**
 * En deçà de ce nombre, la colonne se monte en entier.
 *
 * Virtualiser coûte un observateur de taille par carte et une mesure par rendu : sous
 * une trentaine de cartes, la fenêtre visible vaut à peu près la colonne entière et
 * l'écran d'un petit projet reste exactement ce qu'il était.
 */
export const VIRTUALIZE_FROM = 30;

/** Hauteur estimée d'une carte, gouttière comprise — remesurée ensuite pour de vrai. */
export const CARD_ESTIMATE = 64;

/** Cartes montées de part et d'autre de la fenêtre : le défilement ne montre pas de vide. */
export const CARD_OVERSCAN = 6;

/** Une colonne assez dense pour mériter la virtualisation. */
export function shouldVirtualize(count: number): boolean {
  return count > VIRTUALIZE_FROM;
}

/**
 * Position de la carte en cours de glissement dans la colonne, `-1` si elle n'y est pas.
 *
 * Le board ne connaît qu'un identifiant : chaque colonne cherche s'il est chez elle.
 */
export function activeIndexIn(tasks: readonly { id: number }[], activeTaskId: number | null): number {
  if (activeTaskId == null) return -1;
  return tasks.findIndex((task) => task.id === activeTaskId);
}

/**
 * Force la carte glissée à rester montée, même sortie de la fenêtre visible.
 *
 * Sans elle, faire défiler la colonne pendant un glisser démonterait la carte tenue à la
 * souris : la zone de dépôt (la colonne) tiendrait toujours, mais l'aperçu suivi par le
 * curseur perdrait sa taille de référence et la carte d'origine cesserait d'être grisée.
 * L'index revient trié — le virtualiseur suppose une fenêtre croissante.
 */
export function withActiveIndex(indices: readonly number[], activeIndex: number): number[] {
  if (activeIndex < 0 || indices.includes(activeIndex)) return [...indices];
  const merged = [...indices, activeIndex];
  merged.sort((a, b) => a - b);
  return merged;
}
