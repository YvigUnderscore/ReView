// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { variantOptionAvailable } from './variantAvailability';

describe('variantOptionAvailable (46.P)', () => {
  const baked = [{ prim: '/K/Book_1', set: 'shadingVariant', option: 'BookBlue' }];

  it('the option composed at conversion is always displayable', () => {
    expect(variantOptionAvailable(baked, '/K/Book_1', 'shadingVariant', 'BookTan', 'BookTan')).toBe(true);
    expect(variantOptionAvailable([], '/K/Book_1', 'shadingVariant', 'BookTan', 'BookTan')).toBe(true);
  });

  it('a baked option is available, a non-baked one is not', () => {
    expect(variantOptionAvailable(baked, '/K/Book_1', 'shadingVariant', 'BookBlue', 'BookTan')).toBe(true);
    // That was the symptom: the option appeared in the menu but its geometry was not
    // in the GLB — choosing it changed nothing on screen.
    expect(variantOptionAvailable(baked, '/K/Book_1', 'shadingVariant', 'BookGreen', 'BookTan')).toBe(false);
  });

  it('distinguishes prims and homonymous sets', () => {
    expect(variantOptionAvailable(baked, '/K/Book_2', 'shadingVariant', 'BookBlue', 'BookTan')).toBe(false);
    expect(variantOptionAvailable(baked, '/K/Book_1', 'modelingVariant', 'BookBlue', 'BookTan')).toBe(false);
  });

  it('without baking information (old media), blocks nothing', () => {
    expect(variantOptionAvailable(null, '/K/Book_1', 'shadingVariant', 'BookGreen', 'BookTan')).toBe(true);
    expect(variantOptionAvailable(undefined, '/K/Book_1', 'shadingVariant', 'BookGreen', 'BookTan')).toBe(
      true,
    );
  });
});
