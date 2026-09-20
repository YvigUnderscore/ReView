// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  actionSafeRect,
  centerCrossSegments,
  outlineRect,
  safeAreaRect,
  thirdsLines,
  titleSafeRect,
} from './guideGeometry';
import {
  CENTER_CROSS_RATIO,
  GUIDE_DASH_PX,
  GUIDE_SHADOW_BLUR_PX,
  GUIDE_STROKE_PX,
  guideDashArray,
  guideScale,
  guideShadowBlur,
  guideStrokeProps,
  guideStrokeWidth,
} from './guideStyle';

/** Longueur d'un segment — le `viewBox` étant en pixels, c'est la longueur à l'écran. */
const length = (s: { x1: number; y1: number; x2: number; y2: number }) =>
  Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

describe('centerCrossSegments — croix centrale carrée', () => {
  // L'ancien overlay dessinait en pourcentages avec `preserveAspectRatio="none"` : « 8 unités »
  // valaient 8 % de la largeur en X et 8 % de la hauteur en Y, deux longueurs différentes dès
  // que le média n'était pas carré. La croix était donc un « t » écrasé en 16:9 et en scope.
  const boxes: Array<[string, number, number]> = [
    ['1:1', 1000, 1000],
    ['16:9', 1600, 900],
    ['2.39:1', 2390, 1000],
  ];

  it.each(boxes)('branches de longueur égale en %s', (_name, w, h) => {
    const [horizontal, vertical] = centerCrossSegments(w, h);
    expect(length(horizontal)).toBeCloseTo(length(vertical), 10);
  });

  it.each(boxes)('croix centrée sur le cadre en %s', (_name, w, h) => {
    const [horizontal, vertical] = centerCrossSegments(w, h);
    expect((horizontal.x1 + horizontal.x2) / 2).toBeCloseTo(w / 2, 10);
    expect(horizontal.y1).toBeCloseTo(h / 2, 10);
    expect((vertical.y1 + vertical.y2) / 2).toBeCloseTo(h / 2, 10);
    expect(vertical.x1).toBeCloseTo(w / 2, 10);
  });

  it('cale les branches sur le plus petit côté (jamais de débordement)', () => {
    const [horizontal] = centerCrossSegments(2390, 1000);
    expect(length(horizontal)).toBeCloseTo(2 * 1000 * CENTER_CROSS_RATIO, 10);
  });

  it('reste défini sur une boîte non mesurée', () => {
    expect(centerCrossSegments(0, 0)).toEqual([
      { x1: 0, y1: 0, x2: 0, y2: 0 },
      { x1: 0, y1: 0, x2: 0, y2: 0 },
    ]);
  });
});

describe('thirdsLines / safeAreaRect', () => {
  it('pose les tiers aux tiers du cadre', () => {
    const [v1, v2, h1, h2] = thirdsLines(900, 600);
    expect([v1.x1, v1.x2, v1.y1, v1.y2]).toEqual([300, 300, 0, 600]);
    expect([v2.x1, v2.x2]).toEqual([600, 600]);
    expect([h1.y1, h1.y2, h1.x1, h1.x2]).toEqual([200, 200, 0, 900]);
    expect([h2.y1, h2.y2]).toEqual([400, 400]);
  });

  it('centre la safe area et lui donne la fraction demandée', () => {
    expect(safeAreaRect(1000, 500, 0.9)).toEqual({ x: 50, y: 25, width: 900, height: 450 });
    expect(actionSafeRect(1000, 500)).toEqual({ x: 50, y: 25, width: 900, height: 450 });
    expect(titleSafeRect(1000, 500)).toEqual({ x: 100, y: 50, width: 800, height: 400 });
  });
});

describe('outlineRect — liseré du cadre de livraison', () => {
  it('rentre le tracé d’un demi-trait, sinon le viewport SVG en rogne la moitié', () => {
    expect(outlineRect(800, 450, 1)).toEqual({ x: 0.5, y: 0.5, width: 799, height: 449 });
  });

  it('ne produit jamais de dimension négative', () => {
    expect(outlineRect(0, 0, 1)).toEqual({ x: 0.5, y: 0.5, width: 0, height: 0 });
  });
});

describe('guideStyle — compensation du zoom', () => {
  it('divise toutes les longueurs par l’échelle du calque', () => {
    expect(guideStrokeWidth(1)).toBe(GUIDE_STROKE_PX);
    expect(guideStrokeWidth(4)).toBe(GUIDE_STROKE_PX / 4);
    expect(guideShadowBlur(4)).toBe(GUIDE_SHADOW_BLUR_PX / 4);
    expect(guideDashArray(2)).toBe(`${GUIDE_DASH_PX[0] / 2} ${GUIDE_DASH_PX[1] / 2}`);
  });

  it('ignore une échelle absurde plutôt que de faire disparaître les traits', () => {
    expect(guideScale(0)).toBe(1);
    expect(guideScale(Number.NaN)).toBe(1);
    expect(guideStrokeWidth(-3)).toBe(GUIDE_STROKE_PX);
  });

  it('livre un jeu d’attributs de trait complet, sans remplissage', () => {
    const props = guideStrokeProps(1);
    expect(props.fill).toBe('none');
    expect(props.strokeWidth).toBe(GUIDE_STROKE_PX);
  });
});
