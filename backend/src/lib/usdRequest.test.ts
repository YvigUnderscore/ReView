// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { usdRequestSchema, USD_SELECTION_MAX_PRIMS } from './usdRequest';

/** Sélection de `count` prims distincts, chacun portant un variantSet. */
const selectionOf = (count: number): Record<string, Record<string, string>> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`/World/Asset${i}`, { modelingVariant: 'hero' }]),
  );

describe('usdRequestSchema', () => {
  it('accepte une sélection de variantes et un purpose', () => {
    const parsed = usdRequestSchema.parse({
      variants: { '/World/Asset': { modelingVariant: 'hero' } },
      purpose: 'proxy',
    });
    expect(parsed).toEqual({ variants: { '/World/Asset': { modelingVariant: 'hero' } }, purpose: 'proxy' });
  });

  it('retombe sur une sélection vide en purpose « render »', () => {
    expect(usdRequestSchema.parse({})).toEqual({ variants: {}, purpose: 'render' });
  });

  it('refuse un purpose inconnu', () => {
    expect(usdRequestSchema.safeParse({ purpose: 'beauty' }).success).toBe(false);
  });

  it('borne le volume de la sélection', () => {
    expect(usdRequestSchema.safeParse({ variants: selectionOf(USD_SELECTION_MAX_PRIMS) }).success).toBe(true);
    expect(usdRequestSchema.safeParse({ variants: selectionOf(USD_SELECTION_MAX_PRIMS + 1) }).success).toBe(
      false,
    );
  });

  it('borne la longueur des chemins de prim et des noms de variante', () => {
    expect(usdRequestSchema.safeParse({ variants: { ['/' + 'a'.repeat(1024)]: {} } }).success).toBe(false);
    expect(
      usdRequestSchema.safeParse({ variants: { '/World': { modelingVariant: 'x'.repeat(201) } } }).success,
    ).toBe(false);
  });
});
