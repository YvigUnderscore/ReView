// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { __testing } from './watermarkConfig';

const { sanitize, FALLBACK } = __testing;

describe('watermarkConfig.sanitize', () => {
  it('full fallback to the defaults for an empty input', () => {
    expect(sanitize(undefined, FALLBACK)).toEqual(FALLBACK);
    expect(sanitize({}, FALLBACK)).toEqual(FALLBACK);
  });

  it('accepts booleans and caps the opacity', () => {
    const out = sanitize({ internal: true, shares: false, opacity: 0.9 }, FALLBACK);
    expect(out.internal).toBe(true);
    expect(out.shares).toBe(false);
    expect(out.opacity).toBe(0.4);
    expect(sanitize({ opacity: 0.001 }, FALLBACK).opacity).toBe(0.02);
  });

  it('ignores invalid types', () => {
    const out = sanitize({ internal: 'oui', opacity: 'fort' }, FALLBACK);
    expect(out.internal).toBe(FALLBACK.internal);
    expect(out.opacity).toBe(FALLBACK.opacity);
  });
});
