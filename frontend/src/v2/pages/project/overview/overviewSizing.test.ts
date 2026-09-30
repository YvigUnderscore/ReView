// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { WidgetSpan } from '../../../lib/widgetLayout';
import {
  FALLBACK_GEOMETRY,
  OVERVIEW_GRID_CLASS,
  OVERVIEW_ROWS,
  listCapacity,
  resizeTarget,
  resolveRows,
  rowSpanClass,
  stepSize,
  tileCapacity,
  type WidgetSize,
} from './overviewSizing';

/**
 * La géométrie de la vue d'ensemble, vérifiée sans écran.
 *
 * Trois promesses se jouent ici et nulle part ailleurs : un geste ne produit **jamais** une
 * taille que le bloc ne propose pas, une hauteur enregistrée avant ce lot reste lisible, et
 * une carte plus haute annonce réellement plus de lignes — sans quoi l'agrandir ne ferait
 * que déplacer le vide.
 */

const SPANS: WidgetSpan[] = [4, 6, 8, 12];
const start: WidgetSize = { span: 6, rows: 3 };
const drag = (dx: number, dy: number, spans = SPANS) =>
  resizeTarget(start, { dx, dy }, FALLBACK_GEOMETRY, spans);

describe('resizeTarget', () => {
  it('traduit un glissement horizontal en colonnes', () => {
    // Deux colonnes vers la droite : 6 + 2 = 8, une largeur que le bloc propose.
    expect(drag(2 * FALLBACK_GEOMETRY.column, 0).span).toBe(8);
    expect(drag(-2 * FALLBACK_GEOMETRY.column, 0).span).toBe(4);
  });

  it('traduit un glissement vertical en rangées', () => {
    expect(drag(0, 2 * FALLBACK_GEOMETRY.row).rows).toBe(5);
    expect(drag(0, -FALLBACK_GEOMETRY.row).rows).toBe(2);
  });

  it('règle les deux axes d’un seul geste', () => {
    expect(drag(FALLBACK_GEOMETRY.column, FALLBACK_GEOMETRY.row)).toEqual({ span: 8, rows: 4 });
  });

  it('tranche les ex æquo dans le sens du geste', () => {
    // La rampe des largeurs saute de deux en deux : tirer d'une seule colonne tombe pile
    // entre deux crans. Sans arbitrage, la poignée ne répondrait pas à ce geste-là.
    expect(drag(FALLBACK_GEOMETRY.column, 0).span).toBe(8);
    expect(drag(-FALLBACK_GEOMETRY.column, 0).span).toBe(4);
  });

  it('ne bouge pas tant que le geste n’a pas franchi un demi-cran', () => {
    expect(drag(FALLBACK_GEOMETRY.column / 3, FALLBACK_GEOMETRY.row / 3)).toEqual(start);
  });

  it('borne aux tailles offertes, si loin qu’on tire', () => {
    // C'est la promesse du cran : une grille reste lisible parce qu'aucun geste ne produit
    // une emprise que la page ne sait pas rendre.
    expect(drag(5000, 5000)).toEqual({ span: 12, rows: 6 });
    expect(drag(-5000, -5000)).toEqual({ span: 4, rows: 2 });
  });

  it('ignore les largeurs que ce bloc ne propose pas', () => {
    // Un bloc de médias ne descend pas sous la moitié de la page : tirer vers la gauche
    // s'arrête à 6, pas à 4.
    expect(drag(-5000, 0, [6, 8, 12]).span).toBe(6);
    expect(drag(-FALLBACK_GEOMETRY.column, 0, [6, 8, 12]).span).toBe(6);
  });
});

describe('stepSize — le même réglage au clavier', () => {
  it('avance d’un cran sur l’axe demandé', () => {
    expect(stepSize(start, 'span', 1, SPANS)).toEqual({ span: 8, rows: 3 });
    expect(stepSize(start, 'span', -1, SPANS)).toEqual({ span: 4, rows: 3 });
    expect(stepSize(start, 'rows', 1, SPANS)).toEqual({ span: 6, rows: 4 });
    expect(stepSize(start, 'rows', -1, SPANS)).toEqual({ span: 6, rows: 2 });
  });

  it('ne sort pas de la rampe à ses bornes', () => {
    expect(stepSize({ span: 12, rows: 6 }, 'span', 1, SPANS)).toEqual({ span: 12, rows: 6 });
    expect(stepSize({ span: 12, rows: 6 }, 'rows', 1, SPANS)).toEqual({ span: 12, rows: 6 });
    expect(stepSize({ span: 4, rows: 2 }, 'rows', -1, SPANS)).toEqual({ span: 4, rows: 2 });
  });
});

describe('resolveRows', () => {
  it('prend la hauteur enregistrée', () => {
    expect(resolveRows({ rows: 5 }, 3)).toBe(5);
  });

  it('relit l’ancienne échelle d’une disposition enregistrée avant les rangées', () => {
    // Le but n'est pas de convertir les préférences — on ne les réécrit pas — mais de ne
    // pas perdre le bloc haut que quelqu'un s'était réglé.
    expect(resolveRows({ height: 'tall' }, 3)).toBe(5);
    expect(resolveRows({ height: 'short' }, 4)).toBe(2);
    expect(resolveRows({ height: 'normal' }, 6)).toBe(3);
  });

  it('traite l’absence de hauteur comme le défaut du bloc', () => {
    expect(resolveRows(undefined, 4)).toBe(4);
    expect(resolveRows({ span: 12 }, 2)).toBe(2);
  });

  it('ignore une hauteur hors rampe plutôt que de l’appliquer de travers', () => {
    expect(resolveRows({ rows: 9 }, 3)).toBe(3);
    expect(resolveRows({ rows: 0 }, 3)).toBe(3);
  });

  it('préfère les rangées à l’ancienne échelle quand les deux sont là', () => {
    expect(resolveRows({ rows: 6, height: 'short' }, 3)).toBe(6);
  });
});

describe('le contenu suit la taille', () => {
  it('montre plus de lignes dans une carte plus haute', () => {
    const lines = OVERVIEW_ROWS.map((rows) => listCapacity(rows));
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(new Set(lines).size).toBe(lines.length);
    expect(listCapacity(6)).toBeGreaterThan(2 * listCapacity(2));
  });

  it('montre plus de vignettes dans une carte plus haute ou plus large', () => {
    expect(tileCapacity(6, 12)).toBeGreaterThan(tileCapacity(2, 12));
    expect(tileCapacity(4, 12)).toBeGreaterThan(tileCapacity(4, 6));
    // La plus petite des cartes montre au moins une ligne complète de vignettes.
    expect(tileCapacity(2, 6)).toBe(4);
  });
});

describe('la grille tasse', () => {
  it('déclare le tassement et la hauteur de rangée', () => {
    // Le compactage est celui du navigateur : les rangées qu'un bloc court laisse libres
    // sont prises par le premier bloc suivant qui y tient. Sans `dense`, elles resteraient
    // vides — c'est le défaut entouré en rouge.
    expect(OVERVIEW_GRID_CLASS).toContain('grid-flow-row-dense');
    expect(OVERVIEW_GRID_CLASS).toContain('auto-rows-[5rem]');
  });

  it('écrit une classe d’emprise par hauteur offerte', () => {
    for (const rows of OVERVIEW_ROWS) expect(rowSpanClass(rows)).toBe(`row-span-${String(rows)}`);
  });
});
