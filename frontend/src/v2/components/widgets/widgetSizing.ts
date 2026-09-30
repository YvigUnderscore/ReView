// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WidgetHeight, WidgetSettings, WidgetSpan } from '../../lib/widgetLayout';

/**
 * Le modèle de taille d'une page composable — largeur **et** hauteur, en rangées de grille.
 *
 * Il est né à la vue d'ensemble d'un projet (lot 12), écrit pour elle. L'accueil pose
 * exactement la même demande, mot pour mot : « je veux les mêmes réglages de
 * redimensionnement, de fenêtres, etc. ». Le modèle monte donc d'un étage — il vit avec le
 * cadre commun (`WidgetShell`) et la poignée (`WidgetResizeHandle`), que les deux pages
 * partagent — au lieu d'être recopié une seconde fois.
 *
 * Trois décisions tiennent le comportement :
 *
 *  1. **La hauteur est un nombre de rangées**, pas des pixels libres. Une rangée vaut
 *     `ROW_HEIGHT`, l'écart entre deux rangées est celui de la grille (`gap-6`). Une
 *     disposition enregistrée sur un 27 pouces se rejoue donc à l'identique sur un
 *     portable : seules les colonnes s'étirent, les rangées ont partout la même hauteur.
 *  2. **La grille tasse** (`grid-flow-row-dense`) : un bloc plus court que son voisin
 *     laisse des rangées libres, et le premier bloc suivant qui y tient les prend. C'est
 *     le compactage, obtenu par le navigateur plutôt que par un algorithme de placement
 *     maison — donc juste au pixel, à toutes les largeurs d'écran.
 *  3. **Le contenu suit la taille** : `contentCapacity` dit combien d'éléments d'une
 *     hauteur donnée tiennent dans une carte de N rangées. Agrandir un bloc sans lui
 *     donner plus à montrer n'aurait rien réglé.
 *
 * Tout ce fichier est pur : la géométrie se vérifie sans écran.
 */

/**
 * Hauteurs offertes, en rangées de la grille.
 *
 * Rampe discrète, comme les largeurs : les classes `row-span-*` doivent être écrites en
 * toutes lettres (Tailwind purge ce qu'il ne lit pas), et une hauteur libre au pixel ne
 * survivrait pas au changement d'écran.
 */
export const WIDGET_ROWS = [2, 3, 4, 5, 6] as const;

export type WidgetRows = (typeof WIDGET_ROWS)[number];

/** Hauteur d'une rangée, en pixels (`auto-rows-[5rem]`). */
export const ROW_HEIGHT = 80;

/** Écart entre deux blocs, en pixels (`gap-6`). */
export const GRID_GAP = 24;

/** Pas vertical d'une rangée à la suivante — hauteur de rangée plus écart. */
export const ROW_PITCH = ROW_HEIGHT + GRID_GAP;

/**
 * Classes de la grille d'une page composable : douze colonnes, des rangées de hauteur
 * fixe, et le tassement.
 *
 * Elle remplace la grille à hauteur libre (`items-start`, hauteur du contenu) que l'accueil
 * portait : celle-là alignait les blocs par le haut, si bien qu'un bloc court ouvrait sous
 * lui un trou que son voisin ne pouvait pas combler.
 */
export const WIDGET_ROW_GRID_CLASS = 'grid grid-cols-12 grid-flow-row-dense auto-rows-[5rem] gap-6';

const ROW_SPAN_CLASS: Record<WidgetRows, string> = {
  2: 'row-span-2',
  3: 'row-span-3',
  4: 'row-span-4',
  5: 'row-span-5',
  6: 'row-span-6',
};

export const rowSpanClass = (rows: WidgetRows): string => ROW_SPAN_CLASS[rows];

/**
 * L'ancienne échelle de hauteur (`short`/`normal`/`tall`) relue en rangées.
 *
 * Les dispositions enregistrées avant les rangées portent cette clé et aucune hauteur en
 * rangées. On la traduit **à la lecture** : les préférences ne sont pas réécrites, et
 * personne ne perd le bloc haut qu'il s'était réglé.
 */
const LEGACY_ROWS: Record<WidgetHeight, WidgetRows> = { short: 2, normal: 3, tall: 5 };

export const isWidgetRows = (value: number): value is WidgetRows =>
  (WIDGET_ROWS as readonly number[]).includes(value);

/**
 * Hauteur effective d'un bloc : celle enregistrée, sinon l'ancienne échelle traduite,
 * sinon le défaut du registre. Une valeur hors rampe est ignorée, pas appliquée de travers.
 */
export function resolveRows(saved: WidgetSettings | undefined, fallback: WidgetRows): WidgetRows {
  if (saved?.rows !== undefined && isWidgetRows(saved.rows)) return saved.rows;
  if (saved?.height !== undefined) return LEGACY_ROWS[saved.height];
  return fallback;
}

/**
 * Hauteur du cadre d'une carte, en pixels : ses marges intérieures (`p-4`, deux fois 1 rem)
 * et son en-tête (titre de 1,25 rem plus `mb-3`). C'est ce qui ne sert pas au contenu.
 */
const CARD_CHROME = 68;

/** Pixels réellement offerts au contenu d'une carte de N rangées. */
export const contentHeight = (rows: WidgetRows): number => rows * ROW_PITCH - GRID_GAP - CARD_CHROME;

/**
 * Éléments d'une hauteur donnée qui tiennent dans une carte de N rangées.
 *
 * C'est la seule fonction que les blocs ont à connaître : une liste compte ses lignes, une
 * grille de vignettes ses rangées de vignettes, un bloc à héros ses cartes. Le plancher
 * vaut pour la plus courte des cartes, où mieux vaut quelques éléments qui débordent qu'un
 * bloc vide.
 */
export const contentCapacity = (rows: WidgetRows, lineHeight: number, floor = 1): number =>
  Math.max(floor, Math.floor(contentHeight(rows) / lineHeight));

/** Hauteur d'une ligne de liste (`py-1.5` plus le texte, plus l'interligne `space-y-1.5`). */
export const LIST_LINE = 30;

/** Lignes qu'une liste montre dans une carte de N rangées. */
export const listCapacity = (rows: WidgetRows): number => contentCapacity(rows, LIST_LINE, 3);

/**
 * Hauteur d'une ligne de vignettes : à largeur pleine (huit colonnes), une vignette 16:9
 * fait environ 87 px, son nom 20 px. Une ligne de vignettes vaut donc à peu près une
 * rangée de grille — ce qui rend la rampe lisible : plus haut, plus de lignes.
 */
export const TILE_LINE = 110;

/** Colonnes de vignettes selon la largeur du bloc, et les classes qui les portent. */
const TILE_COLUMNS: Record<WidgetSpan, number> = { 3: 2, 4: 3, 6: 4, 8: 6, 12: 8 };

const TILE_GRID_CLASS: Record<WidgetSpan, string> = {
  3: 'grid-cols-2',
  4: 'grid-cols-2 lg:grid-cols-3',
  6: 'grid-cols-2 lg:grid-cols-4',
  8: 'grid-cols-3 lg:grid-cols-6',
  12: 'grid-cols-4 lg:grid-cols-8',
};

export const tileGridClass = (span: WidgetSpan): string => TILE_GRID_CLASS[span];

/** Vignettes qu'une grille de médias montre dans un bloc de N rangées sur N colonnes. */
export const tileCapacity = (rows: WidgetRows, span: WidgetSpan): number =>
  TILE_COLUMNS[span] * contentCapacity(rows, TILE_LINE);

/** Taille d'un bloc : largeur en colonnes, hauteur en rangées. */
export interface WidgetSize {
  span: WidgetSpan;
  rows: WidgetRows;
}

/** Pas horizontal et vertical de la grille, en pixels — écart compris. */
export interface GridGeometry {
  column: number;
  row: number;
}

/**
 * Géométrie de repli, quand le navigateur ne rend aucune mise en page (rendu de test).
 * Une colonne de 96 px correspond à une grille d'environ 1 130 px de large, soit la
 * largeur utile courante du contenu de l'application.
 */
export const FALLBACK_GEOMETRY: GridGeometry = { column: 96, row: ROW_PITCH };

/**
 * Pas de la grille, lu sur le conteneur lui-même.
 *
 * Le calcul ne suppose rien de la largeur de la fenêtre : `gridTemplateColumns` donne les
 * pistes réellement calculées, ce qui rend le geste juste aux trois paliers responsives
 * comme dans un panneau réduit.
 */
export function gridGeometry(container: Element | null): GridGeometry {
  if (!container || typeof getComputedStyle !== 'function') return FALLBACK_GEOMETRY;
  const style = getComputedStyle(container);
  const gap = Number.parseFloat(style.rowGap);
  const spacing = Number.isFinite(gap) ? gap : GRID_GAP;
  const track = Number.parseFloat(style.gridTemplateColumns.split(' ')[0] ?? '');
  const row = Number.parseFloat(style.gridAutoRows);
  return {
    column: Number.isFinite(track) && track > 0 ? track + spacing : FALLBACK_GEOMETRY.column,
    row: Number.isFinite(row) && row > 0 ? row + spacing : FALLBACK_GEOMETRY.row,
  };
}

/**
 * La valeur offerte la plus proche de celle visée.
 *
 * `bias` est le sens du geste, et il ne sert qu'aux ex æquo — mais ils sont fréquents :
 * la rampe des largeurs saute de deux en deux (4, 6, 8, 12), si bien qu'un glissement
 * d'une seule colonne tombe pile entre deux crans. Sans lui, tirer d'une colonne vers la
 * droite depuis 6 rendrait 6 : la poignée ne répondrait pas.
 */
function nearest<T extends number>(wanted: number, offered: readonly T[], bias: number): T {
  const sorted = [...offered].sort((a, b) => a - b);
  let best = sorted[0];
  for (const value of sorted) {
    const distance = Math.abs(value - wanted);
    const kept = Math.abs(best - wanted);
    if (distance < kept || (distance === kept && bias > 0)) best = value;
  }
  return best;
}

/**
 * Taille visée par un glissement de la poignée : on traduit le déplacement en colonnes et
 * en rangées, puis on retient les tailles offertes les plus proches.
 *
 * Le bornage est ici et nulle part ailleurs : un bloc ne peut pas prendre une largeur que
 * sa définition ne propose pas, ni une hauteur hors rampe, quel que soit le geste.
 */
export function resizeTarget(
  start: WidgetSize,
  delta: { dx: number; dy: number },
  geometry: GridGeometry,
  spans: WidgetSpan[],
): WidgetSize {
  const columns = start.span + Math.round(delta.dx / geometry.column);
  const rows = start.rows + Math.round(delta.dy / geometry.row);
  return {
    span: nearest(columns, spans, delta.dx),
    rows: nearest(rows, WIDGET_ROWS, delta.dy),
  };
}

/**
 * Taille suivante ou précédente sur un axe — ce que fait une flèche du clavier.
 *
 * La poignée est un contrôle, pas un décor : le même réglage doit s'atteindre sans souris.
 * Aux bornes, la taille ne change pas (et l'appelant n'enregistre donc rien).
 */
export function stepSize(
  current: WidgetSize,
  axis: 'span' | 'rows',
  direction: -1 | 1,
  spans: WidgetSpan[],
): WidgetSize {
  if (axis === 'span') {
    const sorted = [...spans].sort((a, b) => a - b);
    const index = sorted.indexOf(current.span);
    return {
      ...current,
      span: sorted[Math.min(sorted.length - 1, Math.max(0, index + direction))] ?? current.span,
    };
  }
  const index = WIDGET_ROWS.indexOf(current.rows);
  const next = WIDGET_ROWS[Math.min(WIDGET_ROWS.length - 1, Math.max(0, index + direction))];
  return { ...current, rows: next ?? current.rows };
}
