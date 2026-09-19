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

/** Largeur d'une colonne de département. */
export const COL_W = 88;

/** Largeur de la colonne de tête : code du plan **et** son statut propre. */
export const HEAD_W = 232;

/** Hauteur d'une ligne, plan comme sequence — uniforme, donc rien à remesurer. */
export const LINE_H = 34;

/** Lignes montées de part et d'autre de la fenêtre : le défilement ne montre pas de vide. */
export const OVERSCAN = 10;

/** Largeur totale d'une ligne pour `n` colonnes visibles. */
export const lineWidth = (columns: number): number => HEAD_W + columns * COL_W;
