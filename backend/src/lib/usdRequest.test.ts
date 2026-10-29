// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { usdRequestSchema, USD_SELECTION_MAX_PRIMS } from './usdRequest';

/** Selection of `count` distinct prims, each carrying a variantSet. */
const selectionOf = (count: number): Record<string, Record<string, string>> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`/World/Asset${i}`, { modelingVariant: 'hero' }]),
  );

describe('usdRequestSchema', () => {
  it('accepts a variant selection and a purpose', () => {
    const parsed = usdRequestSchema.parse({
      variants: { '/World/Asset': { modelingVariant: 'hero' } },
      purpose: 'proxy',
    });
    expect(parsed).toEqual({ variants: { '/World/Asset': { modelingVariant: 'hero' } }, purpose: 'proxy' });
  });

  it('falls back to an empty selection with purpose "render"', () => {
    expect(usdRequestSchema.parse({})).toEqual({ variants: {}, purpose: 'render' });
  });

  it('rejects an unknown purpose', () => {
    expect(usdRequestSchema.safeParse({ purpose: 'beauty' }).success).toBe(false);
  });

  it('caps the size of the selection', () => {
    expect(usdRequestSchema.safeParse({ variants: selectionOf(USD_SELECTION_MAX_PRIMS) }).success).toBe(true);
    expect(usdRequestSchema.safeParse({ variants: selectionOf(USD_SELECTION_MAX_PRIMS + 1) }).success).toBe(
      false,
    );
  });

  it('caps the length of prim paths and variant names', () => {
    expect(usdRequestSchema.safeParse({ variants: { ['/' + 'a'.repeat(1024)]: {} } }).success).toBe(false);
    expect(
      usdRequestSchema.safeParse({ variants: { '/World': { modelingVariant: 'x'.repeat(201) } } }).success,
    ).toBe(false);
  });
});
