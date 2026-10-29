// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  SCRUB_THRESHOLD_PX,
  clampValue,
  dragValue,
  formatValue,
  isScrub,
  parseInput,
  scrubOffset,
  snapToStep,
} from './number-field.math';
import { setLocale } from '../../i18n';

describe('snapToStep', () => {
  it('rounds to the step multiple and cleans up floating-point noise', () => {
    expect(snapToStep(47.3, 1)).toBe(47);
    expect(snapToStep(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(snapToStep(1.2345, 0.002)).toBe(1.234);
  });
  it('leaves the value as is if the step is zero or negative', () => {
    expect(snapToStep(1.234, 0)).toBe(1.234);
  });
});

describe('clampValue', () => {
  const spec = { min: 20, max: 120, step: 1 };
  it('clamps to the extremes', () => {
    expect(clampValue(5, spec)).toBe(20);
    expect(clampValue(500, spec)).toBe(120);
    expect(clampValue(60.4, spec)).toBe(60);
  });
});

describe('dragValue', () => {
  const spec = { min: -180, max: 180, step: 1, pixelsPerStep: 4 };
  it('converts drag pixels into steps', () => {
    expect(dragValue(0, 40, spec)).toBe(10); // 40 px / 4 px per step = 10 steps
    expect(dragValue(0, -40, spec)).toBe(-10);
  });
  it('applies the multiplier (Shift ×10) and stays bounded', () => {
    expect(dragValue(0, 40, spec, 10)).toBe(100);
    expect(dragValue(170, 400, spec)).toBe(180);
  });
});

describe('seuil de scrub', () => {
  it('only recognises the gesture once the threshold is crossed, in both directions', () => {
    expect(isScrub(SCRUB_THRESHOLD_PX - 1)).toBe(false);
    expect(isScrub(-(SCRUB_THRESHOLD_PX - 1))).toBe(false);
    expect(isScrub(SCRUB_THRESHOLD_PX)).toBe(true);
    expect(isScrub(-SCRUB_THRESHOLD_PX)).toBe(true);
    expect(isScrub(0)).toBe(false);
  });
  it('removes the threshold from the movement: the value does not jump at the start', () => {
    expect(scrubOffset(SCRUB_THRESHOLD_PX)).toBe(0);
    expect(scrubOffset(-SCRUB_THRESHOLD_PX)).toBe(0);
    expect(scrubOffset(40)).toBe(40 - SCRUB_THRESHOLD_PX);
    expect(scrubOffset(-40)).toBe(-(40 - SCRUB_THRESHOLD_PX));
  });
});

describe('parseInput', () => {
  it('accepts the French decimal comma and rejects non-numeric input', () => {
    expect(parseInput('12,5')).toBe(12.5);
    expect(parseInput(' 47 ')).toBe(47);
    expect(parseInput('abc')).toBeNull();
    expect(parseInput('')).toBeNull();
  });
});

describe('formatValue', () => {
  it('follows the language and stays readable by parseInput', async () => {
    await setLocale('fr');
    expect(formatValue(0.25, 0.05)).toBe('0,25');
    // No thousands separator: a frame number reads back exactly as it is displayed.
    expect(parseInput(formatValue(1001, 1))).toBe(1001);
    await setLocale('en');
    expect(formatValue(0.25, 0.05)).toBe('0.25');
    expect(parseInput(formatValue(1001, 1))).toBe(1001);
  });

  it('displays without unnecessary decimals depending on the step', () => {
    expect(formatValue(47, 1)).toBe('47');
    expect(formatValue(0.25, 0.05)).toBe('0.25');
  });
});
