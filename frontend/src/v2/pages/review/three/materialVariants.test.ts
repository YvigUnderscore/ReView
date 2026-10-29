// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { pickVariantMaterialIndex, readVariants } from './materialVariants';

describe('materialVariants — KHR_materials_variants (40.C)', () => {
  it('reads the variant names (or [] if absent)', () => {
    expect(readVariants({ userData: { variants: ['Rouge', 'Bleu'] } } as unknown as GLTF)).toEqual([
      'Rouge',
      'Bleu',
    ]);
    expect(readVariants({ userData: {} } as unknown as GLTF)).toEqual([]);
  });

  it('picks the material mapped to the variant, otherwise null (default / unmapped)', () => {
    const mappings = [
      { material: 3, variants: [0] },
      { material: 7, variants: [1, 2] },
    ];
    expect(pickVariantMaterialIndex(mappings, 0)).toBe(3);
    expect(pickVariantMaterialIndex(mappings, 2)).toBe(7);
    // Variant not covered by a mapping → original material.
    expect(pickVariantMaterialIndex(mappings, 5)).toBeNull();
    // Default (-1) → original material.
    expect(pickVariantMaterialIndex(mappings, -1)).toBeNull();
  });
});
