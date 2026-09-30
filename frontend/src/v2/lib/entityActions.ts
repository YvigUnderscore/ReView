// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Portée d'une action de menu face à une sélection multiple (A3).
 *
 * La règle était appliquée à un seul endroit, à la main : sur la page Reviews, l'ajout à
 * une playlist tenait compte de la sélection, la suppression juste en dessous non — et
 * les autres listes l'ignoraient complètement. Une seule règle, testée, s'applique
 * désormais partout : **si l'élément cliqué fait partie de la sélection, l'action porte
 * sur toute la sélection ; sinon, sur le seul élément cliqué.**
 */

/** Éléments sur lesquels l'action doit réellement porter. */
export function actionTarget(clickedId: number, selection: readonly number[]): number[] {
  return selection.length > 1 && selection.includes(clickedId) ? [...selection] : [clickedId];
}

/** Vrai si l'action va porter sur plusieurs éléments : le libellé doit alors l'annoncer. */
export function isBulkTarget(clickedId: number, selection: readonly number[]): boolean {
  return actionTarget(clickedId, selection).length > 1;
}

/**
 * Libellé d'une action, complété du nombre d'éléments visés quand il y en a plusieurs.
 * Rien n'est concaténé en dur : le suffixe est fourni traduit par l'appelant.
 */
export function scopedLabel(label: string, count: number, countLabel: (n: number) => string): string {
  return count > 1 ? `${label} — ${countLabel(count)}` : label;
}
