// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { COL_W_MAX, COL_W_MIN, HEAD_W, columnWidth, lineWidth } from './gridLayout';

/**
 * La largeur des colonnes, depuis que la case écrit le nom de son statut.
 *
 * Deux écueils à éviter, et ce sont eux que ces cas verrouillent : une grille qui garde la
 * largeur d'avant coupe « In Progress » au milieu, une grille taillée pour le pire nom
 * imaginable impose à tout le monde une table qu'on ne voit plus d'un écran.
 */
describe('columnWidth', () => {
  it('ne prend pas un pixel de plus qu’avant quand les noms sont courts', () => {
    // « Final », « Omitted », « ip » : un référentiel ShotGrid tient dans la largeur d'avant.
    expect(columnWidth(0)).toBe(COL_W_MIN);
    expect(columnWidth('Final'.length)).toBe(COL_W_MIN);
  });

  it('élargit pour le vocabulaire local, que toute instance reçoit à la migration', () => {
    const width = columnWidth('In Progress'.length);
    expect(width).toBeGreaterThan(COL_W_MIN);
    expect(width).toBeLessThanOrEqual(COL_W_MAX);
  });

  it('plafonne : un nom interminable se coupe, il n’emporte pas la table', () => {
    expect(columnWidth('Pending Supervisor And Client Approval'.length)).toBe(COL_W_MAX);
    expect(columnWidth(500)).toBe(COL_W_MAX);
  });

  it('ne rétrécit jamais quand le nom s’allonge', () => {
    let previous = 0;
    for (let length = 0; length <= 40; length += 1) {
      const width = columnWidth(length);
      expect(width).toBeGreaterThanOrEqual(previous);
      previous = width;
    }
  });
});

describe('lineWidth', () => {
  it('additionne la colonne de tête et les colonnes de département', () => {
    expect(lineWidth(0, 100)).toBe(HEAD_W);
    expect(lineWidth(12, 100)).toBe(HEAD_W + 1200);
  });
});
