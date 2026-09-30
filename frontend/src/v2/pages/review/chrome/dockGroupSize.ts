// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * À partir de combien d'entrées un groupe repliable du dock arrive **replié**.
 *
 * Aucun groupe du dock n'était repliable : le panneau Infos d'une scène USD riche — fiche
 * technique, scène USD, une ligne par texture — se parcourait à l'ascenseur, et les mesures de
 * la frame courante, qui tiennent en quatre lignes, partaient hors champ. Le seuil est posé à
 * la hauteur utile du dock : en dessous, tout se lit d'un coup d'œil et replier coûterait un
 * clic pour rien ; au-dessus, le groupe se présente fermé, avec son décompte.
 *
 * Dans un fichier à lui plutôt qu'à côté de `Group` : le dock n'exporte que des composants,
 * et une fonction de plus y casserait le rechargement à chaud (`react-refresh`).
 */
export const DOCK_GROUP_COLLAPSE_THRESHOLD = 6;

/** Ce groupe est-il assez long pour arriver replié ? */
export function isLongDockGroup(count: number): boolean {
  return count > DOCK_GROUP_COLLAPSE_THRESHOLD;
}
