// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Mesures de la grille, en un seul endroit.
 *
 * Une table virtualisée n'est plus une table : l'en-tête, la colonne de tête et les lignes
 * sont trois éléments distincts qui doivent tomber au même pixel. Ces valeurs sont donc des
 * nombres posés en style, pas des classes — un `w-24` recopié dans trois fichiers finit par
 * décaler l'en-tête d'un demi-caractère.
 */

/**
 * Largeur d'une colonne quand les noms de statut sont courts.
 *
 * C'est la largeur d'avant le nom dans la case : un studio dont le référentiel dit
 * « Final », « Omitted » ne paie pas un pixel de plus qu'auparavant.
 */
export const COL_W_MIN = 88;

/**
 * Plafond de largeur. Au-delà, douze colonnes ne tiennent plus sous aucun défilement
 * raisonnable : un nom plus long que ça se coupe et se relit au survol.
 */
export const COL_W_MAX = 136;

/**
 * Ce qu'une case dépense hors nom : filet de séparation (1), marges du bouton (12),
 * pastille (10), avatar (16) et les deux écarts qui les séparent (8).
 */
const CELL_CHROME = 47;

/**
 * Largeur d'un caractère à `text-2xs` (11 px), à la grosse.
 *
 * Une **constante**, et c'est tout l'intérêt : douze cents cases ne se mesurent pas au
 * DOM. L'approximation ne peut que faire déborder un nom d'un caractère ou deux, ce que
 * `truncate` rattrape — jamais casser la mise en page.
 */
const CHAR_W = 6.5;

/**
 * Largeur de colonne pour un nom de statut de `longestName` caractères.
 *
 * La grille s'élargit juste ce qu'il faut pour le nom le plus long réellement servi, au
 * lieu d'imposer à tous la largeur du pire référentiel imaginable : le vocabulaire local
 * par défaut (« In Progress ») demande une vingtaine de pixels de plus, un vocabulaire
 * ShotGrid (« Final ») n'en demande aucun.
 */
export function columnWidth(longestName: number): number {
  const wanted = CELL_CHROME + longestName * CHAR_W;
  // Quantifié à 4 px : la largeur ne bouge pas d'un cheveu à chaque page chargée.
  return Math.min(COL_W_MAX, Math.max(COL_W_MIN, Math.ceil(wanted / 4) * 4));
}

/** Largeur de la colonne de tête : code du plan **et** son statut propre. */
export const HEAD_W = 232;

/** Hauteur d'une ligne, plan comme sequence — uniforme, donc rien à remesurer. */
export const LINE_H = 34;

/** Lignes montées de part et d'autre de la fenêtre : le défilement ne montre pas de vide. */
export const OVERSCAN = 10;

/** Largeur totale d'une ligne pour `n` colonnes visibles de `colWidth` pixels. */
export const lineWidth = (columns: number, colWidth: number): number => HEAD_W + columns * colWidth;
