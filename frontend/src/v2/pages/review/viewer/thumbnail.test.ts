// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { toThumbnail } from './thumbnail';

/**
 * `toThumbnail` est la seule pièce purement logique de la couche scène splat (les autres
 * helpers dépendent de WebGL/Spark, couverts par le typecheck/build). On vérifie ici les
 * gardes déterministes : un canvas sans dimension ne produit pas de miniature.
 */
describe('toThumbnail', () => {
  it('renvoie null si le canvas a une largeur nulle', () => {
    const c = document.createElement('canvas');
    c.width = 0;
    c.height = 150;
    expect(toThumbnail(c)).toBeNull();
  });

  it('renvoie null si le canvas a une hauteur nulle', () => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 0;
    expect(toThumbnail(c)).toBeNull();
  });

  it('ne lève pas et renvoie string|null pour un canvas dimensionné', () => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 150;
    const out = toThumbnail(c);
    expect(out === null || typeof out === 'string').toBe(true);
  });
});
