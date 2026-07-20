import { describe, expect, it } from 'vitest';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { pickVariantMaterialIndex, readVariants } from './materialVariants';

describe('materialVariants — KHR_materials_variants (40.C)', () => {
  it('lit les noms de variantes (ou [] si absent)', () => {
    expect(readVariants({ userData: { variants: ['Rouge', 'Bleu'] } } as unknown as GLTF)).toEqual([
      'Rouge',
      'Bleu',
    ]);
    expect(readVariants({ userData: {} } as unknown as GLTF)).toEqual([]);
  });

  it('choisit le matériau mappé à la variante, sinon null (défaut / non mappé)', () => {
    const mappings = [
      { material: 3, variants: [0] },
      { material: 7, variants: [1, 2] },
    ];
    expect(pickVariantMaterialIndex(mappings, 0)).toBe(3);
    expect(pickVariantMaterialIndex(mappings, 2)).toBe(7);
    // Variante non couverte par un mapping → matériau d'origine.
    expect(pickVariantMaterialIndex(mappings, 5)).toBeNull();
    // Défaut (-1) → matériau d'origine.
    expect(pickVariantMaterialIndex(mappings, -1)).toBeNull();
  });
});
