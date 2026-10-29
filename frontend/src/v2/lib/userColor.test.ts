// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { USER_COLORS, contrastRatio, readableInk, userColor } from './userColor';

describe('userColor', () => {
  it('returns the same hue for the same identifier', () => {
    expect(userColor(42)).toBe(userColor(42));
    expect(userColor('ana')).toBe(userColor('ana'));
  });

  it('stays within the palette', () => {
    for (const seed of [0, 1, 7, 99, 'ana', 'milo']) {
      expect(USER_COLORS).toContain(userColor(seed));
    }
  });
});

describe('readableInk — initials legibility (WCAG AA)', () => {
  /**
   * The initials used to be written in white across the whole palette: NONE of the twelve hues
   * met 4.5:1 that way — from 1.98:1 on lemon green to 4.47:1 at best. This test covers any
   * hue added later: a colour no ink makes readable fails here.
   */
  it.each([...USER_COLORS])('%s carries an ink that meets 4.5:1', (color) => {
    expect(contrastRatio(color, readableInk(color))).toBeGreaterThanOrEqual(4.5);
  });

  it('white alone was not enough — that is why we compute', () => {
    const failing = USER_COLORS.filter((c) => contrastRatio(c, '#ffffff') < 4.5);
    expect(failing).toHaveLength(USER_COLORS.length);
  });

  it('picks the more contrasting of the two inks', () => {
    expect(readableInk('#ffffff')).toBe('#000000');
    expect(readableInk('#000000')).toBe('#ffffff');
  });
});

describe('contrastRatio', () => {
  it('returns 21:1 between black and white, 1:1 for a colour against itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#3b82f6', '#3b82f6')).toBeCloseTo(1, 5);
  });
});
