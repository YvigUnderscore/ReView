// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, afterEach } from 'vitest';
import { applyAccent, hexToHsl } from './branding';

describe('branding — hexToHsl (42.B №101)', () => {
  it('converts base colours', () => {
    expect(hexToHsl('#000000')).toBe('0 0% 0%');
    expect(hexToHsl('#ffffff')).toBe('0 0% 100%');
    expect(hexToHsl('#ff0000')).toBe('0 100% 50%');
    expect(hexToHsl('#00ff00')).toBe('120 100% 50%');
    expect(hexToHsl('#0000ff')).toBe('240 100% 50%');
  });

  it('accepts with or without "#" and is case-insensitive', () => {
    expect(hexToHsl('00B3C4')).toBe(hexToHsl('#00b3c4'));
  });

  it('returns null for an invalid input', () => {
    expect(hexToHsl('#abc')).toBeNull();
    expect(hexToHsl('pas une couleur')).toBeNull();
    expect(hexToHsl('')).toBeNull();
  });
});

/**
 * The accent chosen by an administrator serves three purposes: the button fill, the colour of
 * accented text, and the focus ring. The last two are read ON the background: applying the same
 * vivid hue to both themes left `#1ec6dc` at 1.93:1 on the light background — invisible keyboard
 * focus, unreadable links.
 */
describe('branding — the studio accent adapts to the theme', () => {
  const root = document.documentElement;
  const lightnessOf = (prop: string) =>
    Number.parseFloat(root.style.getPropertyValue(prop).split(' ')[2] ?? '');

  afterEach(() => {
    applyAccent(null);
    root.classList.remove('dark');
  });

  it('darkens an accent that is too light in light theme', () => {
    root.classList.remove('dark');
    applyAccent('#1ec6dc'); // L = 49%
    expect(lightnessOf('--primary')).toBeLessThanOrEqual(38);
    expect(lightnessOf('--ring')).toBeLessThanOrEqual(38);
  });

  it('lightens an accent that is too dark in dark theme', () => {
    root.classList.add('dark');
    applyAccent('#0a3d46'); // very dark accent
    expect(lightnessOf('--primary')).toBeGreaterThanOrEqual(45);
  });

  it('leaves an accent that is already readable as is', () => {
    root.classList.add('dark');
    applyAccent('#1ec6dc');
    expect(lightnessOf('--primary')).toBeCloseTo(49, 0);
  });

  it('hands control back to the theme tokens when the accent is removed', () => {
    applyAccent('#1ec6dc');
    applyAccent(null);
    expect(root.style.getPropertyValue('--primary')).toBe('');
    expect(root.style.getPropertyValue('--ring')).toBe('');
  });
});
