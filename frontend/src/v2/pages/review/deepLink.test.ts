// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { commentLink, frameLink, frameToTime, parseDeepLink } from './deepLink';

describe('deepLink (32.E)', () => {
  it('builds frame and comment links on the current path', () => {
    expect(frameLink('https://s.fr', '/review/shot-12', 1042)).toBe('https://s.fr/review/shot-12?frame=1042');
    expect(commentLink('https://s.fr', '/review/12', 7)).toBe('https://s.fr/review/12?comment=7');
  });

  it('parses valid parameters and ignores the rest', () => {
    expect(parseDeepLink('?frame=1042')).toEqual({ frame: 1042 });
    expect(parseDeepLink('?comment=7')).toEqual({ commentId: 7 });
    expect(parseDeepLink('?frame=abc&comment=-2')).toEqual({});
    expect(parseDeepLink('')).toEqual({});
  });

  it('frameToTime: based on startFrame, clamped to 0, invalid fps tolerated', () => {
    expect(frameToTime(1042, 1001, 24)).toBeCloseTo(41 / 24);
    expect(frameToTime(900, 1001, 24)).toBe(0);
    expect(frameToTime(1042, 1001, 0)).toBe(0);
  });
});
