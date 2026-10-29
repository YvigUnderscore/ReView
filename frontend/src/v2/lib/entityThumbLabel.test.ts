// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { thumbAbbrev, thumbScale } from './entityThumbLabel';

/**
 * The abbreviation is for production names, not people's names: two shots of the same sequence
 * share everything except their number. Taking the initials would make them identical.
 */
describe('thumbAbbrev', () => {
  it('keeps the last number of the name — it is what tells two shots apart', () => {
    expect(thumbAbbrev('SH0120')).toBe('0120');
    expect(thumbAbbrev('SQ010_SH0130')).toBe('0130');
    expect(thumbAbbrev('EP02')).toBe('02');
  });

  it('caps the abbreviation at four digits', () => {
    expect(thumbAbbrev('SH1234567')).toBe('4567');
  });

  it('falls back to the initials when the name carries no digit', () => {
    expect(thumbAbbrev('Le Grand Voyage')).toBe('LG');
    expect(thumbAbbrev('bunker')).toBe('BU');
    expect(thumbAbbrev('deep_forest')).toBe('DF');
  });

  it('does not split a character in two halves', () => {
    // Emoji and ideographs take two code units: a naive `slice(0, 2)` would produce half a
    // character, displayed as a black lozenge.
    expect(thumbAbbrev('🎬 clap')).toBe('🎬C');
  });

  it('accepts an empty name without inventing anything', () => {
    expect(thumbAbbrev('   ')).toBe('');
  });
});

describe('thumbScale', () => {
  it('shrinks the font as the name gets longer', () => {
    expect(thumbScale('SQ010')).toBe('text-xl');
    expect(thumbScale('Le Grand Voyage')).toBe('text-base');
    expect(thumbScale('Le Grand Voyage de Mémé')).toBe('text-sm');
    expect(thumbScale('x'.repeat(40))).toBe('text-xs');
  });
});
