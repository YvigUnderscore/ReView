// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { builtinCube, couplesFor, MAX_COUPLES } from './bakeJob';
import { parseCube } from '../../lib/ocioBake';

const displays = [
  { name: 'sRGB - Display', views: ['ACES 1.0 - SDR Video', 'Un-tone-mapped', 'Raw'] },
  { name: 'Rec.1886 Rec.709 - Display', views: ['ACES 1.0 - SDR Video', 'Raw'] },
];

describe('bakeJob — choosing the pairs', () => {
  it('bakes all the pairs of the default config', () => {
    expect(couplesFor(displays, {})).toHaveLength(5);
  });

  it('an explicit pair bakes only that one', () => {
    expect(couplesFor(displays, { display: 'sRGB - Display', view: 'Raw' })).toEqual([
      { display: 'sRGB - Display', view: 'Raw' },
    ]);
  });

  it('a display alone is not enough to target: the whole config is baked', () => {
    expect(couplesFor(displays, { display: 'sRGB - Display' })).toHaveLength(5);
  });

  it('caps the number of pairs (a corrupted config does not flood the queue)', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      name: `D${i}`,
      views: ['Raw', 'Un-tone-mapped', 'Log', 'ACES 1.0 - SDR Video'],
    }));
    expect(couplesFor(many, {})).toHaveLength(MAX_COUPLES);
  });
});

describe('bakeJob — built-in fallback', () => {
  it('produces a re-readable .cube for a colorimetric view', () => {
    const text = builtinCube('sRGB - Display', 'Un-tone-mapped')!;
    expect(text).toContain('LUT_3D_SIZE 33');
    expect(text).toContain('source: built-in colorimetric');
    expect(parseCube(text).size).toBe(33);
  });

  it('returns null for a tone-mapped view: this LUT is not approximated', () => {
    expect(builtinCube('sRGB - Display', 'ACES 1.0 - SDR Video')).toBeNull();
  });
});
