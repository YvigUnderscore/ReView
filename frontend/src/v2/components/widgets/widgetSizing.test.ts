// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  FALLBACK_GEOMETRY,
  WIDGET_ROWS,
  WIDGET_ROW_GRID_CLASS,
  contentCapacity,
  listCapacity,
  resizeTarget,
  resolveRows,
  rowSpanClass,
  stepSize,
  tileCapacity,
  type WidgetSize,
} from './widgetSizing';
import type { WidgetSpan } from '../../lib/widgetLayout';

/**
 * Le modèle de taille partagé par les pages composables — la géométrie du geste, la
 * relecture des anciennes dispositions, et ce que la taille offre au contenu.
 *
 * Il est monté ici depuis la vue d'ensemble pour que l'accueil le reçoive tel quel, plutôt
 * qu'une seconde copie qu'il faudrait corriger deux fois. Ce que ces cas verrouillent, c'est
 * précisément ce qui doit rester vrai des deux côtés : un geste ne produit jamais une
 * emprise que la grille ne sait pas rendre, une préférence enregistrée avant les rangées se
 * relit sans être réécrite, et une carte plus grande montre réellement plus de choses.
 */

const SPANS: WidgetSpan[] = [4, 6, 8, 12];
const start: WidgetSize = { span: 6, rows: 3 };

const drag = (dx: number, dy: number, spans: WidgetSpan[] = SPANS) =>
  resizeTarget(start, { dx, dy }, FALLBACK_GEOMETRY, spans);

describe('resizeTarget — le geste de la poignée', () => {
  it('traduit le glissement en colonnes et en rangées', () => {
    expect(drag(FALLBACK_GEOMETRY.column, 0)).toEqual({ span: 8, rows: 3 });
    expect(drag(0, FALLBACK_GEOMETRY.row)).toEqual({ span: 6, rows: 4 });
    // Un seul geste règle les deux axes : c'est toute la demande.
    expect(drag(2 * FALLBACK_GEOMETRY.column, 2 * FALLBACK_GEOMETRY.row)).toEqual({ span: 8, rows: 5 });
  });

  it('ne bouge pas tant que le geste n’a pas franchi un demi-cran', () => {
    expect(drag(FALLBACK_GEOMETRY.column / 3, FALLBACK_GEOMETRY.row / 3)).toEqual(start);
  });

  it('borne aux tailles offertes, si loin qu’on tire', () => {
    expect(drag(5000, 5000)).toEqual({ span: 12, rows: 6 });
    expect(drag(-5000, -5000)).toEqual({ span: 4, rows: 2 });
  });

  it('ignore les largeurs que le bloc ne propose pas', () => {
    expect(drag(-5000, 0, [6, 8, 12]).span).toBe(6);
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
    expect(stepSize({ span: 12, rows: 6 }, 'rows', 1, SPANS)).toEqual({ span: 12, rows: 6 });
    expect(stepSize({ span: 4, rows: 2 }, 'span', -1, SPANS)).toEqual({ span: 4, rows: 2 });
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
    const lines = WIDGET_ROWS.map((rows) => listCapacity(rows));
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(new Set(lines).size).toBe(lines.length);
    expect(listCapacity(6)).toBeGreaterThan(2 * listCapacity(2));
  });

  it('montre plus de vignettes dans une carte plus haute ou plus large', () => {
    expect(tileCapacity(6, 12)).toBeGreaterThan(tileCapacity(2, 12));
    expect(tileCapacity(4, 12)).toBeGreaterThan(tileCapacity(4, 6));
  });

  it('offre au moins le plancher demandé, même à la plus courte des cartes', () => {
    // Mieux vaut quelques éléments qui débordent qu'un bloc vide : une carte de deux
    // rangées n'offre pas de place à trois lignes, elle en montre trois quand même.
    expect(contentCapacity(2, 1000)).toBe(1);
    expect(contentCapacity(2, 1000, 3)).toBe(3);
    expect(listCapacity(2)).toBe(3);
  });
});

describe('la grille tasse', () => {
  it('déclare le tassement et la hauteur de rangée', () => {
    // Le compactage est celui du navigateur : les rangées qu'un bloc court laisse libres
    // sont prises par le premier bloc suivant qui y tient. Sans `dense`, elles resteraient
    // vides — c'est le défaut que l'accueil portait avec `items-start`.
    expect(WIDGET_ROW_GRID_CLASS).toContain('grid-flow-row-dense');
    expect(WIDGET_ROW_GRID_CLASS).toContain('auto-rows-[5rem]');
    expect(WIDGET_ROW_GRID_CLASS).not.toContain('items-start');
  });

  it('écrit une classe d’emprise par hauteur offerte', () => {
    // Une classe Tailwind construite par interpolation est purgée au build.
    for (const rows of WIDGET_ROWS) {
      expect(rowSpanClass(rows)).toBe(`row-span-${String(rows)}`);
      expect(rowSpanClass(rows)).not.toContain('${');
    }
  });
});
