import { describe, expect, it } from 'vitest';
import { variantOptionAvailable } from './variantAvailability';

describe('variantOptionAvailable (46.P)', () => {
  const baked = [{ prim: '/K/Book_1', set: 'shadingVariant', option: 'BookBlue' }];

  it('l’option composée à la conversion est toujours montrable', () => {
    expect(variantOptionAvailable(baked, '/K/Book_1', 'shadingVariant', 'BookTan', 'BookTan')).toBe(true);
    expect(variantOptionAvailable([], '/K/Book_1', 'shadingVariant', 'BookTan', 'BookTan')).toBe(true);
  });

  it('une option cuite est disponible, une option non cuite ne l’est pas', () => {
    expect(variantOptionAvailable(baked, '/K/Book_1', 'shadingVariant', 'BookBlue', 'BookTan')).toBe(true);
    // C'était le symptôme : l'option apparaissait au menu mais sa géométrie n'était pas
    // dans le GLB — la choisir ne changeait rien à l'écran.
    expect(variantOptionAvailable(baked, '/K/Book_1', 'shadingVariant', 'BookGreen', 'BookTan')).toBe(false);
  });

  it('distingue les prims et les jeux homonymes', () => {
    expect(variantOptionAvailable(baked, '/K/Book_2', 'shadingVariant', 'BookBlue', 'BookTan')).toBe(false);
    expect(variantOptionAvailable(baked, '/K/Book_1', 'modelingVariant', 'BookBlue', 'BookTan')).toBe(false);
  });

  it('sans information de cuisson (vieux média), ne bloque rien', () => {
    expect(variantOptionAvailable(null, '/K/Book_1', 'shadingVariant', 'BookGreen', 'BookTan')).toBe(true);
    expect(variantOptionAvailable(undefined, '/K/Book_1', 'shadingVariant', 'BookGreen', 'BookTan')).toBe(
      true,
    );
  });
});
